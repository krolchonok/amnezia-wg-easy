'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('path');
const https = require('node:https');
const net = require('node:net');
const dns = require('node:dns').promises;
const debug = require('debug')('WireGuard');
const crypto = require('node:crypto');
const QRCode = require('qrcode');

const Util = require('./Util');
const ServerError = require('./ServerError');
const TrafficHistory = require('./TrafficHistory');
const ConfigStore = require('./ConfigStore');

const {
  WG_PATH,
  WG_HOST,
  WG_PORT,
  WG_CONFIG_PORT,
  WG_MTU,
  WG_DEFAULT_DNS,
  WG_DEFAULT_ADDRESS,
  WG_DEVICE,
  WG_DNS_ROUTING_ENABLED,
  WG_DNS_ROUTING_UPSTREAMS,
  WG_PERSISTENT_KEEPALIVE,
  WG_ALLOWED_IPS,
  WG_UPLINK_ENABLED,
  WG_UPLINK_INTERFACE,
  WG_UPLINK_CONFIG_PATH,
  WG_UPLINK_CONFIGS_PATH,
  WG_UPLINK_TABLE,
  WG_UPLINK_SOURCE_RULES,
  WG_PRE_UP,
  WG_POST_UP,
  WG_PRE_DOWN,
  WG_POST_DOWN,
  WG_ENABLE_EXPIRES_TIME,
  WG_ENABLE_ONE_TIME_LINKS,
  TRAFFIC_HISTORY_ENABLED,
  TRAFFIC_SAMPLE_INTERVAL_SECONDS,
  TRAFFIC_RAW_RETENTION_HOURS,
  TRAFFIC_MINUTE_RETENTION_DAYS,
  TRAFFIC_HOUR_RETENTION_DAYS,
  JC,
  JMIN,
  JMAX,
  S1,
  S2,
  H1,
  H2,
  H3,
  H4,
} = require('../config');

const ensureUplinkConfigTableOff = (content) => {
  const normalizedContent = String(content).replace(/\r\n/g, '\n');
  const lines = normalizedContent.split('\n');
  let interfaceStart = -1;
  let interfaceEnd = lines.length;

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (!match) {
      continue;
    }

    if (match[1].trim().toLowerCase() === 'interface') {
      interfaceStart = index;
      continue;
    }

    if (interfaceStart !== -1) {
      interfaceEnd = index;
      break;
    }
  }

  if (interfaceStart === -1) {
    return normalizedContent;
  }

  const interfaceLines = lines.slice(interfaceStart + 1, interfaceEnd);
  const tableLineIndex = interfaceLines.findIndex((line) => /^\s*Table\s*=.*$/i.test(line));

  if (tableLineIndex !== -1) {
    interfaceLines[tableLineIndex] = 'Table = off';
  } else {
    interfaceLines.push('Table = off');
  }

  return [
    ...lines.slice(0, interfaceStart + 1),
    ...interfaceLines,
    ...lines.slice(interfaceEnd),
  ].join('\n');
};

const hasUplinkConfigTableOff = (content) => /^\s*Table\s*=\s*off\s*$/im.test(String(content));

module.exports = class WireGuard {

  constructor() {
    this.__resolvedWgHost = null;
    this.__runtimeSettings = this.__getEnvRuntimeSettings();
    this.__trafficSamplerEnabled = this.__runtimeSettings.trafficHistoryEnabled;
    this.__trafficSamplerStarted = false;
    this.__trafficSamplerTimer = null;
    this.__uplinkRuntime = [];
    this.__dnsRoutingRuntime = null;
    this.__dnsRoutingSyncPromise = Promise.resolve();
    this.__lifecyclePromise = Promise.resolve();
    this.__configInitializingPromise = null;
    this.__configPromise = null;
    this.__configStore = new ConfigStore({
      basePath: WG_PATH,
    });
    this.__trafficHistory = new TrafficHistory({
      basePath: WG_PATH,
      sampleIntervalSeconds: this.__runtimeSettings.trafficSampleIntervalSeconds,
      rawRetentionHours: this.__runtimeSettings.trafficRawRetentionHours,
      minuteRetentionDays: this.__runtimeSettings.trafficMinuteRetentionDays,
      hourRetentionDays: this.__runtimeSettings.trafficHourRetentionDays,
    });
  }

  __getEnvRuntimeSettings() {
    return {
      wgHost: typeof WG_HOST === 'string' ? WG_HOST.trim() : '',
      defaultDns: typeof WG_DEFAULT_DNS === 'string' ? WG_DEFAULT_DNS.trim() : '1.1.1.1',
      wgPort: String(WG_PORT),
      wgConfigPort: String(WG_CONFIG_PORT),
      wgMtu: WG_MTU || '',
      wgDefaultAddress: WG_DEFAULT_ADDRESS,
      wgAllowedIps: WG_ALLOWED_IPS,
      wgPersistentKeepalive: String(WG_PERSISTENT_KEEPALIVE),
      enableExpireTime: WG_ENABLE_EXPIRES_TIME === 'true',
      enableOneTimeLinks: WG_ENABLE_ONE_TIME_LINKS === 'true',
      trafficHistoryEnabled: TRAFFIC_HISTORY_ENABLED === 'true',
      trafficSampleIntervalSeconds: TRAFFIC_SAMPLE_INTERVAL_SECONDS,
      trafficRawRetentionHours: TRAFFIC_RAW_RETENTION_HOURS,
      trafficMinuteRetentionDays: TRAFFIC_MINUTE_RETENTION_DAYS,
      trafficHourRetentionDays: TRAFFIC_HOUR_RETENTION_DAYS,
    };
  }

  __applyRuntimeSettings(settings = {}) {
    const merged = {
      ...this.__getEnvRuntimeSettings(),
      ...(settings || {}),
    };

    merged.wgHost = typeof merged.wgHost === 'string' ? merged.wgHost.trim() : '';
    merged.defaultDns = typeof merged.defaultDns === 'string' ? merged.defaultDns.trim() : '1.1.1.1';
    merged.wgPort = String(merged.wgPort || WG_PORT).trim();
    merged.wgConfigPort = String(merged.wgConfigPort || merged.wgPort || WG_CONFIG_PORT).trim();
    merged.wgMtu = typeof merged.wgMtu === 'string' ? merged.wgMtu.trim() : '';
    merged.wgDefaultAddress = typeof merged.wgDefaultAddress === 'string' && merged.wgDefaultAddress.trim()
      ? merged.wgDefaultAddress.trim()
      : WG_DEFAULT_ADDRESS;
    merged.wgAllowedIps = typeof merged.wgAllowedIps === 'string' && merged.wgAllowedIps.trim()
      ? merged.wgAllowedIps.trim()
      : WG_ALLOWED_IPS;
    merged.wgPersistentKeepalive = String(merged.wgPersistentKeepalive || WG_PERSISTENT_KEEPALIVE).trim();
    merged.enableExpireTime = merged.enableExpireTime === true;
    merged.enableOneTimeLinks = merged.enableOneTimeLinks === true;
    merged.trafficHistoryEnabled = merged.trafficHistoryEnabled === true;
    merged.trafficSampleIntervalSeconds = Math.max(1, parseInt(merged.trafficSampleIntervalSeconds, 10) || TRAFFIC_SAMPLE_INTERVAL_SECONDS);
    merged.trafficRawRetentionHours = Math.max(1, parseInt(merged.trafficRawRetentionHours, 10) || TRAFFIC_RAW_RETENTION_HOURS);
    merged.trafficMinuteRetentionDays = Math.max(1, parseInt(merged.trafficMinuteRetentionDays, 10) || TRAFFIC_MINUTE_RETENTION_DAYS);
    merged.trafficHourRetentionDays = Math.max(1, parseInt(merged.trafficHourRetentionDays, 10) || TRAFFIC_HOUR_RETENTION_DAYS);

    this.__runtimeSettings = merged;
    this.__trafficSamplerEnabled = merged.trafficHistoryEnabled;
    this.__trafficHistory.sampleIntervalSeconds = merged.trafficSampleIntervalSeconds;
    this.__trafficHistory.rawRetentionHours = merged.trafficRawRetentionHours;
    this.__trafficHistory.minuteRetentionDays = merged.trafficMinuteRetentionDays;
    this.__trafficHistory.hourRetentionDays = merged.trafficHourRetentionDays;
  }

  __getRuntimeNetworkCidr(runtime) {
    return `${runtime.wgDefaultAddress.replace('x', '0')}/24`;
  }

  __getRuntimePostUp(runtime) {
    if (process.env.WG_POST_UP) {
      return WG_POST_UP;
    }

    return `
iptables -t nat -A POSTROUTING -s ${this.__getRuntimeNetworkCidr(runtime)} -o ${WG_DEVICE} -j MASQUERADE;
iptables -A INPUT -p udp -m udp --dport ${runtime.wgPort} -j ACCEPT;
iptables -A FORWARD -i wg0 -j ACCEPT;
iptables -A FORWARD -o wg0 -j ACCEPT;
`.split('\n').join(' ');
  }

  __getRuntimePostDown(runtime) {
    if (process.env.WG_POST_DOWN) {
      return WG_POST_DOWN;
    }

    return `
iptables -t nat -D POSTROUTING -s ${this.__getRuntimeNetworkCidr(runtime)} -o ${WG_DEVICE} -j MASQUERADE;
iptables -D INPUT -p udp -m udp --dport ${runtime.wgPort} -j ACCEPT;
iptables -D FORWARD -i wg0 -j ACCEPT;
iptables -D FORWARD -o wg0 -j ACCEPT;
`.split('\n').join(' ');
  }

  async __loadRuntimeSettings() {
    const settings = await this.__getAppSettings();
    this.__applyRuntimeSettings(settings);
    return this.__runtimeSettings;
  }

  __runLifecycleExclusive(fn) {
    const run = this.__lifecyclePromise
      .catch(() => {})
      .then(fn);

    this.__lifecyclePromise = run.catch(() => {});
    return run;
  }

  async __getAppSettings() {
    const settings = await this.__configStore.getAppSettings().catch(() => null);
    return settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {};
  }

  async __getConfiguredWgHost() {
    const settings = await this.__loadRuntimeSettings();
    return settings.wgHost;
  }

  async __getConfiguredDefaultDns() {
    const settings = await this.__loadRuntimeSettings();
    return settings.defaultDns;
  }

  async reloadRuntimeSettings() {
    return this.__runLifecycleExclusive(async () => {
      const previousTrafficEnabled = this.__trafficSamplerEnabled;
      await this.__loadRuntimeSettings();
      this.__resolvedWgHost = null;
      if (previousTrafficEnabled && !this.__trafficSamplerEnabled) {
        await this.stopTrafficHistorySampler();
      } else if (!previousTrafficEnabled && this.__trafficSamplerEnabled) {
        await this.startTrafficHistorySampler();
      }
      await this.__resolveWgHost({ required: false });
    });
  }

  async applyRuntimeSettings() {
    return this.__runLifecycleExclusive(async () => {
      const previousTrafficEnabled = this.__trafficSamplerEnabled;
      await this.__loadRuntimeSettings();
      const config = await this.__getConfigUnlocked();
      this.__pruneClientIsolationRules(config);
      this.__normalizeUplinkSettingsList(config);
      this.__normalizeClientUplinkAssignments(config);
      this.__normalizeUplinkProtectedCidrs(config);
      await this.__saveConfig(config);
      await Util.exec('wg-quick down wg0').catch(() => {});
      await Util.exec('wg-quick up wg0').catch((err) => {
        if (err && err.message && err.message.includes('Cannot find device "wg0"')) {
          throw new Error('WireGuard exited with the error: Cannot find device "wg0"\nThis usually means that your host\'s kernel does not support WireGuard!');
        }

        throw err;
      });
      await this.__syncConfig();
      await this.__syncClientIsolationFirewall(config);
      await this.__syncUplinkRouting(config);
      await this.__syncDnsRouting(config);
      this.__configPromise = config;
      this.__resolvedWgHost = null;
      if (previousTrafficEnabled && !this.__trafficSamplerEnabled) {
        await this.stopTrafficHistorySampler();
      } else if (!previousTrafficEnabled && this.__trafficSamplerEnabled) {
        await this.startTrafficHistorySampler();
      }
      await this.__resolveWgHost({ required: false });
      return config;
    });
  }

  __getDefaultClientIsolation() {
    return {
      enabled: false,
      rules: [],
    };
  }

  __getDefaultUplinkSettings(index = 0) {
    const configPath = typeof WG_UPLINK_CONFIG_PATH === 'string' ? WG_UPLINK_CONFIG_PATH.trim() : '';
    const interfaceName = typeof WG_UPLINK_INTERFACE === 'string' ? WG_UPLINK_INTERFACE.trim() : '';

    return {
      id: crypto.randomUUID(),
      name: interfaceName || `Uplink ${index + 1}`,
      enabled: WG_UPLINK_ENABLED === 'true',
      configPath,
      interfaceName,
      table: Math.max(1, parseInt(WG_UPLINK_TABLE, 10) || 200),
      sourceRules: [...new Set(
        String(WG_UPLINK_SOURCE_RULES || '')
          .split(/[\n,;]+/)
          .map((value) => value.trim())
          .filter(Boolean)
      )],
      destinationDomains: [],
    };
  }

  __getEmptyUplinkSettings(index = 0) {
    return {
      id: crypto.randomUUID(),
      name: `Uplink ${index + 1}`,
      enabled: false,
      configPath: '',
      interfaceName: '',
      table: Math.max(1, parseInt(WG_UPLINK_TABLE, 10) || 200),
      sourceRules: [],
      destinationDomains: [],
    };
  }

  __getDefaultDnsRoutingSettings() {
    return {
      enabled: WG_DNS_ROUTING_ENABLED === 'true',
      upstreams: [...new Set(
        String(WG_DNS_ROUTING_UPSTREAMS || WG_DEFAULT_DNS || '')
          .split(/[\s,\n;]+/)
          .map((value) => value.trim())
          .filter(Boolean)
      )],
    };
  }

  __getDefaultRoutingCategory(index = 0) {
    return {
      id: crypto.randomUUID(),
      name: `Category ${index + 1}`,
      enabled: true,
      uplinkId: null,
      domains: [],
    };
  }

  __normalizeRoutingCategories(config) {
    const rawCategories = Array.isArray(config?.routingCategories)
      ? config.routingCategories
      : [];

    config.routingCategories = rawCategories
      .filter((category) => category && typeof category === 'object' && !Array.isArray(category))
      .map((category, index) => {
        const fallback = this.__getDefaultRoutingCategory(index);
        const domains = Array.isArray(category.domains)
          ? category.domains
          : typeof category.domains === 'string'
            ? category.domains.split(/[\n,;]+/)
            : [];

        return {
          id: typeof category.id === 'string' && category.id.trim() ? category.id.trim() : fallback.id,
          name: typeof category.name === 'string' && category.name.trim() ? category.name.trim() : fallback.name,
          enabled: category.enabled !== false,
          uplinkId: typeof category.uplinkId === 'string' && category.uplinkId.trim() ? category.uplinkId.trim() : null,
          domains: [...new Set(
            domains
              .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
              .filter(Boolean)
          )],
        };
      });

    return config.routingCategories;
  }

  __normalizeClientRoutingCategoryAssignments(config) {
    const assignments = config && typeof config.clientRoutingCategories === 'object' && !Array.isArray(config.clientRoutingCategories)
      ? config.clientRoutingCategories
      : {};
    const categories = this.__normalizeRoutingCategories(config);
    const categoryIds = new Set(categories.map((category) => category.id));
    const normalized = {};

    for (const [clientId, categoryIdsValue] of Object.entries(assignments)) {
      if (!config.clients[clientId]) {
        continue;
      }

      const values = Array.isArray(categoryIdsValue)
        ? categoryIdsValue
        : typeof categoryIdsValue === 'string'
          ? categoryIdsValue.split(/[\n,;]+/)
          : [];

      const enabledCategoryIds = [...new Set(
        values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value && categoryIds.has(value))
      )];

      if (enabledCategoryIds.length > 0) {
        normalized[clientId] = enabledCategoryIds;
      }
    }

    config.clientRoutingCategories = normalized;
    return normalized;
  }

  __validateRoutingCategories(config) {
    const categories = this.__normalizeRoutingCategories(config);
    const uplinks = this.__normalizeUplinkSettingsList(config);
    const uplinkIds = new Set(uplinks.map((uplink) => uplink.id));
    const seenIds = new Set();

    config.routingCategories = categories.filter((category) => {
      if (seenIds.has(category.id)) {
        return false;
      }

      seenIds.add(category.id);
      if (!category.uplinkId || !uplinkIds.has(category.uplinkId)) {
        return false;
      }

      return category.domains.length > 0;
    });

    return config.routingCategories;
  }

  __getEnabledRoutingCategoriesForClient(config, clientId) {
    const assignments = this.__normalizeClientRoutingCategoryAssignments(config);
    const categories = this.__validateRoutingCategories(config);
    const assignedCategoryIds = new Set(assignments[clientId] || []);

    return categories.filter((category) => category.enabled && assignedCategoryIds.has(category.id));
  }

  __getEnabledRoutingCategoriesForUplink(config, uplinkId) {
    const categories = this.__validateRoutingCategories(config);
    const assignments = this.__normalizeClientRoutingCategoryAssignments(config);
    const result = [];

    for (const category of categories) {
      if (!category.enabled || category.uplinkId !== uplinkId) {
        continue;
      }

      const clientIds = Object.entries(assignments)
        .filter(([, categoryIds]) => Array.isArray(categoryIds) && categoryIds.includes(category.id))
        .map(([clientId]) => clientId)
        .filter((clientId) => !!config.clients[clientId]);

      if (clientIds.length === 0) {
        continue;
      }

      result.push({
        ...category,
        clientIds,
      });
    }

    return result;
  }

  __normalizeClientUplinkAssignments(config) {
    const assignments = config && typeof config.clientUplinkAssignments === 'object' && !Array.isArray(config.clientUplinkAssignments)
      ? config.clientUplinkAssignments
      : {};
    const uplinks = this.__normalizeUplinkSettingsList(config);
    const uplinkIds = new Set(uplinks.map((uplink) => uplink.id));
    const normalized = {};

    for (const [clientId, uplinkId] of Object.entries(assignments)) {
      if (!config.clients[clientId]) {
        continue;
      }

      if (typeof uplinkId !== 'string' || !uplinkId.trim()) {
        continue;
      }

      const normalizedUplinkId = uplinkId.trim();
      if (normalizedUplinkId === 'main') {
        normalized[clientId] = 'main';
        continue;
      }

      if (!uplinkIds.has(normalizedUplinkId)) {
        continue;
      }

      normalized[clientId] = normalizedUplinkId;
    }

    config.clientUplinkAssignments = normalized;
    return normalized;
  }

  __getExplicitClientUplinkRuleOverrides(config) {
    const assignments = this.__normalizeClientUplinkAssignments(config);
    const overrides = {};

    for (const [clientId, assignedUplinkId] of Object.entries(assignments)) {
      const client = config.clients[clientId];
      if (!client || !client.address) {
        continue;
      }

      overrides[`${client.address}/32`] = assignedUplinkId;
    }

    return overrides;
  }

  __getAssignedClientSourceRules(config, uplinkId) {
    const assignments = this.__normalizeClientUplinkAssignments(config);
    const sourceRules = [];

    for (const [clientId, assignedUplinkId] of Object.entries(assignments)) {
      if (assignedUplinkId !== uplinkId) {
        continue;
      }

      const client = config.clients[clientId];
      if (!client || !client.address) {
        continue;
      }

      sourceRules.push(`${client.address}/32`);
    }

    return [...new Set(sourceRules)];
  }

  __getEffectiveUplinkSettings(config, uplink) {
    const explicitRuleOverrides = this.__getExplicitClientUplinkRuleOverrides(config);
    const assignedSourceRules = this.__getAssignedClientSourceRules(config, uplink.id);
    const manualSourceRules = (Array.isArray(uplink.sourceRules) ? uplink.sourceRules : [])
      .filter((sourceRule) => explicitRuleOverrides[sourceRule] === undefined);

    return {
      ...uplink,
      sourceRules: [...new Set([
        ...manualSourceRules,
        ...assignedSourceRules,
      ])],
    };
  }

  __normalizeSingleUplinkSettings(uplink, fallback, index) {
    const sourceRulesFallback = Array.isArray(fallback?.sourceRules) ? fallback.sourceRules : [];
    const rawSourceRules = Array.isArray(uplink?.sourceRules)
      ? uplink.sourceRules
      : typeof uplink?.sourceRules === 'string'
        ? uplink.sourceRules.split(/[\n,;]+/)
        : sourceRulesFallback;
    const rawDestinationDomains = Array.isArray(uplink?.destinationDomains)
      ? uplink.destinationDomains
      : typeof uplink?.destinationDomains === 'string'
        ? uplink.destinationDomains.split(/[\n,;]+/)
        : [];

    const configPath = typeof uplink?.configPath === 'string' ? uplink.configPath.trim() : fallback.configPath;
    const interfaceFromPath = configPath.endsWith('.conf')
      ? path.posix.basename(configPath, '.conf')
      : '';
    const interfaceName = typeof uplink?.interfaceName === 'string' && uplink.interfaceName.trim()
      ? uplink.interfaceName.trim()
      : (interfaceFromPath || fallback.interfaceName);
    const name = typeof uplink?.name === 'string' && uplink.name.trim()
      ? uplink.name.trim()
      : (interfaceName || fallback.name || `Uplink ${index + 1}`);

    return {
      id: typeof uplink?.id === 'string' && uplink.id.trim() ? uplink.id.trim() : (fallback.id || crypto.randomUUID()),
      name,
      enabled: uplink?.enabled === true,
      configPath,
      interfaceName,
      table: Math.max(1, parseInt(uplink?.table, 10) || fallback.table),
      sourceRules: [...new Set(
        rawSourceRules
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      )],
      destinationDomains: [...new Set(
        rawDestinationDomains
          .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
          .filter(Boolean)
      )],
    };
  }

  __normalizeUplinkSettingsList(config) {
    const hasStoredUplinks = Array.isArray(config?.uplinks);
    const hasLegacyStoredUplink = config && typeof config.uplink === 'object' && !Array.isArray(config.uplink);
    const fallback = hasStoredUplinks || hasLegacyStoredUplink
      ? this.__getEmptyUplinkSettings()
      : this.__getDefaultUplinkSettings();
    const rawUplinks = hasStoredUplinks
      ? config.uplinks
      : (hasLegacyStoredUplink
        ? [config.uplink]
        : [fallback]);

    config.uplinks = rawUplinks
      .filter((uplink) => uplink && typeof uplink === 'object' && !Array.isArray(uplink))
      .map((uplink, index) => this.__normalizeSingleUplinkSettings(uplink, index === 0 ? fallback : this.__getDefaultUplinkSettings(index), index));

    if (config.uplinks.length === 0) {
      config.uplink = hasStoredUplinks || hasLegacyStoredUplink
        ? this.__getEmptyUplinkSettings()
        : this.__getDefaultUplinkSettings();
      return config.uplinks;
    }

    config.uplink = { ...config.uplinks[0] };
    return config.uplinks;
  }

  __normalizeUplinkSettings(config) {
    const uplinks = this.__normalizeUplinkSettingsList(config);
    return uplinks[0] || config.uplink || this.__getEmptyUplinkSettings();
  }

  __normalizeDnsRoutingSettings(config) {
    const defaults = this.__getDefaultDnsRoutingSettings();
    const raw = config && typeof config.dnsRouting === 'object' && !Array.isArray(config.dnsRouting)
      ? config.dnsRouting
      : defaults;

    config.dnsRouting = {
      enabled: raw.enabled === true,
      upstreams: [...new Set(
        (Array.isArray(raw.upstreams) ? raw.upstreams : typeof raw.upstreams === 'string' ? raw.upstreams.split(/[\s,\n;]+/) : defaults.upstreams)
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      )],
    };

    if (config.dnsRouting.upstreams.length === 0) {
      config.dnsRouting.upstreams = [...defaults.upstreams];
    }

    return config.dnsRouting;
  }

  __normalizeUplinkProtectedCidrs(config) {
    const raw = Array.isArray(config?.uplinkProtectedCidrs)
      ? config.uplinkProtectedCidrs
      : typeof config?.uplinkProtectedCidrs === 'string'
        ? config.uplinkProtectedCidrs.split(/[\n,;]+/)
        : [];

    config.uplinkProtectedCidrs = [...new Set(
      raw
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
        .map((value) => {
          try {
            return this.__parseIpv4Cidr(value, { defaultPrefix: 32 }).canonical;
          } catch (err) {
            throw new ServerError(`Invalid protected CIDR: ${value}`, 400);
          }
        })
    )];

    return config.uplinkProtectedCidrs;
  }

  __normalizeAclGroupName(groupName) {
    if (typeof groupName !== 'string') {
      return '';
    }

    const normalizedGroupName = groupName.trim();
    if (!normalizedGroupName) {
      return '';
    }

    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(normalizedGroupName)) {
      throw new ServerError(`Invalid ACL group: ${groupName}`, 400);
    }

    return normalizedGroupName;
  }

  __normalizeClientAclGroups(client) {
    const rawGroups = Array.isArray(client.aclGroups)
      ? client.aclGroups
      : typeof client.aclGroups === 'string'
        ? client.aclGroups.split(/[,\n;]+/)
        : [];

    client.aclGroups = [...new Set(
      rawGroups
        .map((groupName) => this.__normalizeAclGroupName(groupName))
        .filter(Boolean)
    )];

    return client.aclGroups;
  }

  async getAvailableUplinkConfigs() {
    const basePath = typeof WG_UPLINK_CONFIGS_PATH === 'string'
      ? WG_UPLINK_CONFIGS_PATH.trim()
      : '';

    if (!basePath) {
      return [];
    }

    const entries = await fs.readdir(basePath, { withFileTypes: true }).catch((err) => {
      if (err && err.code === 'ENOENT') {
        return [];
      }

      throw new ServerError(`Unable to read uplink config directory (${basePath}): ${err.message}`, 400);
    });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.conf'))
      .map((entry) => ({
        name: entry.name,
        path: path.posix.join(basePath, entry.name),
        interfaceName: path.posix.basename(entry.name, '.conf'),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveUplinkConfigFile({
    filename,
    content,
  }) {
    const basePath = typeof WG_UPLINK_CONFIGS_PATH === 'string'
      ? WG_UPLINK_CONFIGS_PATH.trim()
      : '';

    if (!basePath) {
      throw new ServerError('WG_UPLINK_CONFIGS_PATH is not configured.', 400);
    }

    const rawFilename = typeof filename === 'string' ? filename.trim() : '';
    if (!rawFilename) {
      throw new ServerError('Uplink config filename is required.', 400);
    }

    const normalizedInputFilename = /\.(conf|txt)$/i.test(rawFilename)
      ? rawFilename
      : `${rawFilename}.conf`;

    if (!/^[A-Za-z0-9_.-]+\.(conf|txt)$/i.test(normalizedInputFilename)) {
      throw new ServerError('Uplink config filename contains unsupported characters.', 400);
    }

    if (typeof content !== 'string' || !content.trim()) {
      throw new ServerError('Uplink config content is empty.', 400);
    }

    const basename = normalizedInputFilename.toLowerCase().endsWith('.txt')
      ? path.posix.basename(normalizedInputFilename, '.txt')
      : path.posix.basename(normalizedInputFilename, '.conf');
    const normalizedFilename = `${basename}.conf`;
    const interfaceName = basename;
    const hasInterfaceSection = /^\s*\[Interface\]\s*$/im.test(content);
    if (!hasInterfaceSection) {
      throw new ServerError('Uplink config must contain an [Interface] section.', 400);
    }

    const normalizedContent = ensureUplinkConfigTableOff(content);

    await fs.mkdir(basePath, { recursive: true }).catch((err) => {
      throw new ServerError(`Unable to create uplink config directory (${basePath}): ${err.message}`, 400);
    });

    const targetPath = path.posix.join(basePath, normalizedFilename);
    await fs.writeFile(targetPath, `${normalizedContent.trimEnd()}\n`, {
      mode: 0o600,
    }).catch((err) => {
      throw new ServerError(`Unable to write uplink config (${targetPath}): ${err.message}`, 400);
    });

    return {
      name: normalizedFilename,
      path: targetPath,
      interfaceName,
    };
  }

  async startTrafficHistorySampler() {
    await this.__loadRuntimeSettings();
    if (!this.__trafficSamplerEnabled || this.__trafficSamplerStarted) {
      return;
    }

    this.__trafficSamplerStarted = true;
    await this.__trafficHistory.init();

    const tick = async () => {
      if (!this.__trafficSamplerStarted) {
        return;
      }

      try {
        const clients = await this.getClients();
        await this.__trafficHistory.recordClients(clients);
      } catch (err) {
        debug(`Traffic sampler failed: ${err.message}`);
      } finally {
        if (this.__trafficSamplerStarted) {
          this.__trafficSamplerTimer = setTimeout(tick, this.__runtimeSettings.trafficSampleIntervalSeconds * 1000);
        }
      }
    };

    await tick();
  }

  async stopTrafficHistorySampler() {
    this.__trafficSamplerStarted = false;
    if (this.__trafficSamplerTimer) {
      clearTimeout(this.__trafficSamplerTimer);
      this.__trafficSamplerTimer = null;
    }

    if (this.__trafficSamplerEnabled) {
      await this.__trafficHistory.flush().catch((err) => {
        debug(`Traffic sampler flush failed: ${err.message}`);
      });
    }
  }

  __normalizeClientName(name) {
    if (typeof name !== 'string') {
      throw new ServerError('Missing: Name', 400);
    }

    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new ServerError('Missing: Name', 400);
    }

    if (normalizedName.length > 64) {
      throw new ServerError('Name too long', 400);
    }

    if ([...normalizedName].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })) {
      throw new ServerError('Name contains invalid control characters', 400);
    }

    return normalizedName;
  }

  __escapeShellArgument(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }

  __ipv4ToInteger(address) {
    return address.split('.').reduce((result, octet) => {
      return ((result << 8) >>> 0) + Number(octet);
    }, 0);
  }

  __parseIpv4Cidr(value, {
    defaultPrefix = 32,
  } = {}) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('Expected IPv4 or CIDR value');
    }

    const normalizedValue = value.trim();
    const [address, prefixRaw] = normalizedValue.split('/');
    const prefix = typeof prefixRaw === 'undefined'
      ? defaultPrefix
      : Number.parseInt(prefixRaw, 10);

    if (!Util.isValidIPv4(address)) {
      throw new Error(`Invalid IPv4 address: ${value}`);
    }

    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`Invalid IPv4 prefix: ${value}`);
    }

    const integer = this.__ipv4ToInteger(address);
    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const network = integer & mask;
    const broadcast = (network | (~mask >>> 0)) >>> 0;

    return {
      address,
      prefix,
      canonical: `${address}/${prefix}`,
      network,
      broadcast,
    };
  }

  __getUplinkRulePriority(uplinkIndex, ruleIndex = 0) {
    return 11000 + (uplinkIndex * 1000) + ruleIndex;
  }

  __getUplinkMarkRulePriority(uplinkIndex) {
    return 10000 + uplinkIndex;
  }

  __getUplinkMarkValue(uplinkIndex) {
    return 200 + uplinkIndex;
  }

  __getProtectedUplinkMarkValue() {
    return 0x64;
  }

  __getProtectedUplinkRulePriority() {
    return 9999;
  }

  __getUplinkDomainSetName(uplink) {
    const suffix = crypto.createHash('sha1')
      .update(`${uplink.id}:${uplink.interfaceName}`)
      .digest('hex')
      .slice(0, 12);

    return `awg_dom_${suffix}`;
  }

  __getRoutingCategorySetName(category) {
    const suffix = crypto.createHash('sha1')
      .update(`${category.id}:${category.uplinkId || 'none'}`)
      .digest('hex')
      .slice(0, 12);

    return `awg_cat_${suffix}`;
  }

  __normalizeClientIsolation(config) {
    const isolation = config && typeof config.clientIsolation === 'object' && !Array.isArray(config.clientIsolation)
      ? config.clientIsolation
      : this.__getDefaultClientIsolation();

    const enabled = isolation.enabled === true;
    const rules = Array.isArray(isolation.rules)
      ? isolation.rules
      : [];

    config.clientIsolation = {
      enabled,
      rules: rules
        .filter((rule) => rule && typeof rule === 'object' && !Array.isArray(rule))
        .map((rule) => ({
          id: typeof rule.id === 'string' && rule.id.length > 0
            ? rule.id
            : crypto.randomUUID(),
          action: rule.action === 'deny' ? 'deny' : 'allow',
          sourceType: typeof rule.sourceType === 'string'
            ? rule.sourceType
            : (typeof rule.sourceClientId === 'string' ? 'client' : 'client'),
          sourceValue: typeof rule.sourceValue === 'string'
            ? rule.sourceValue
            : (typeof rule.sourceClientId === 'string' ? rule.sourceClientId : ''),
          targetType: typeof rule.targetType === 'string'
            ? rule.targetType
            : (typeof rule.targetClientId === 'string' ? 'client' : 'client'),
          targetValue: typeof rule.targetValue === 'string'
            ? rule.targetValue
            : (typeof rule.targetClientId === 'string' ? rule.targetClientId : ''),
          bidirectional: rule.bidirectional !== false,
          enabled: rule.enabled !== false,
        })),
    };

    return config.clientIsolation;
  }

  __validateUplinkSettings(settings) {
    const normalizedSettings = {
      id: typeof settings?.id === 'string' && settings.id.trim() ? settings.id.trim() : crypto.randomUUID(),
      name: typeof settings?.name === 'string' && settings.name.trim() ? settings.name.trim() : '',
      enabled: settings && settings.enabled === true,
      configPath: typeof settings?.configPath === 'string' ? settings.configPath.trim() : '',
      interfaceName: typeof settings?.interfaceName === 'string' ? settings.interfaceName.trim() : '',
      table: Math.max(1, parseInt(settings?.table, 10) || 200),
      sourceRules: [...new Set(
        (Array.isArray(settings?.sourceRules) ? settings.sourceRules : [])
          .map((value) => this.__parseIpv4Cidr(value).canonical)
      )],
      destinationDomains: [...new Set(
        (Array.isArray(settings?.destinationDomains) ? settings.destinationDomains : [])
          .map((value) => this.__normalizeDomainName(value))
      )],
    };

    if (!normalizedSettings.name) {
      normalizedSettings.name = normalizedSettings.interfaceName || 'Uplink';
    }

    if (!normalizedSettings.enabled) {
      return normalizedSettings;
    }

    if (!normalizedSettings.configPath) {
      throw new ServerError('Uplink config path is required when uplink is enabled.', 400);
    }

    if (!normalizedSettings.configPath.endsWith('.conf')) {
      throw new ServerError('Uplink config path must point to a .conf file.', 400);
    }

    const interfaceFromPath = path.posix.basename(normalizedSettings.configPath, '.conf');
    const interfaceName = normalizedSettings.interfaceName || interfaceFromPath;

    if (!/^[A-Za-z0-9_.-]+$/.test(interfaceName)) {
      throw new ServerError(`Invalid uplink interface: ${interfaceName}`, 400);
    }

    if (interfaceName === 'wg0') {
      throw new ServerError('Uplink interface must not be wg0.', 400);
    }

    if (interfaceName !== interfaceFromPath) {
      throw new ServerError(`Uplink interface (${interfaceName}) must match config filename (${interfaceFromPath}).`, 400);
    }

    normalizedSettings.interfaceName = interfaceName;
    return normalizedSettings;
  }

  __normalizeDomainName(value) {
    if (typeof value !== 'string') {
      throw new ServerError('Invalid domain name', 400);
    }

    const domain = value.trim().toLowerCase();
    if (!domain) {
      throw new ServerError('Invalid domain name', 400);
    }

    if (domain.length > 253) {
      throw new ServerError(`Domain name is too long: ${domain}`, 400);
    }

    if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) {
      throw new ServerError(`Invalid domain name: ${domain}`, 400);
    }

    return domain;
  }

  __validateUplinkSettingsList(settingsList) {
    const normalizedSettingsList = (Array.isArray(settingsList) ? settingsList : [])
      .map((settings, index) => this.__validateUplinkSettings({
        ...settings,
        name: typeof settings?.name === 'string' && settings.name.trim()
          ? settings.name.trim()
          : `Uplink ${index + 1}`,
      }));

    const enabledSettings = normalizedSettingsList.filter((settings) => settings.enabled);
    const duplicateInterface = enabledSettings.find((settings, index) => enabledSettings.findIndex((candidate) => candidate.interfaceName === settings.interfaceName) !== index);
    if (duplicateInterface) {
      throw new ServerError(`Duplicate uplink interface: ${duplicateInterface.interfaceName}`, 400);
    }

    const duplicateTable = enabledSettings.find((settings, index) => enabledSettings.findIndex((candidate) => candidate.table === settings.table) !== index);
    if (duplicateTable) {
      throw new ServerError(`Duplicate uplink routing table: ${duplicateTable.table}`, 400);
    }

    return normalizedSettingsList;
  }

  __validateDnsRoutingSettings(settings) {
    const normalized = {
      enabled: settings && settings.enabled === true,
      upstreams: [...new Set(
        (Array.isArray(settings?.upstreams) ? settings.upstreams : typeof settings?.upstreams === 'string' ? settings.upstreams.split(/[\s,\n;]+/) : [])
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      )],
    };

    normalized.upstreams = normalized.upstreams.map((upstream) => {
      if (net.isIP(upstream)) {
        return upstream;
      }

      return this.__normalizeDomainName(upstream);
    });

    if (normalized.enabled && normalized.upstreams.length === 0) {
      throw new ServerError('At least one upstream resolver is required when VPN DNS routing is enabled.', 400);
    }

    return normalized;
  }

  __validateClientIsolationRule(rule, clients) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new ServerError('Invalid isolation rule', 400);
    }

    const action = rule.action === 'deny' ? 'deny' : 'allow';
    const sourceType = typeof rule.sourceType === 'string' ? rule.sourceType.trim() : 'client';
    const targetType = typeof rule.targetType === 'string' ? rule.targetType.trim() : 'client';
    const sourceValue = typeof rule.sourceValue === 'string' ? rule.sourceValue.trim() : '';
    const targetValue = typeof rule.targetValue === 'string' ? rule.targetValue.trim() : '';

    if (!['all', 'client', 'group', 'cidr'].includes(sourceType)) {
      throw new ServerError(`Unsupported isolation sourceType: ${sourceType}`, 400);
    }

    if (!['all', 'client', 'group', 'cidr'].includes(targetType)) {
      throw new ServerError(`Unsupported isolation targetType: ${targetType}`, 400);
    }

    if ((sourceType !== 'all' && !sourceValue) || (targetType !== 'all' && !targetValue)) {
      throw new ServerError('Isolation rule requires source and target selectors', 400);
    }

    if (sourceType === 'client') {
      if (!clients[sourceValue]) {
        throw new ServerError(`Isolation rule source client not found: ${sourceValue}`, 400);
      }
    } else if (sourceType === 'all') {
      // No selector value required.
    } else if (sourceType === 'group') {
      this.__normalizeAclGroupName(sourceValue);
    } else {
      this.__parseIpv4Cidr(sourceValue);
    }

    if (targetType === 'client') {
      if (!clients[targetValue]) {
        throw new ServerError(`Isolation rule target client not found: ${targetValue}`, 400);
      }
    } else if (targetType === 'all') {
      // No selector value required.
    } else if (targetType === 'group') {
      this.__normalizeAclGroupName(targetValue);
    } else {
      this.__parseIpv4Cidr(targetValue);
    }

    if (sourceType === targetType && sourceValue === targetValue && sourceType !== 'all') {
      throw new ServerError('Isolation rule source and target selectors must differ', 400);
    }

    return {
      id: typeof rule.id === 'string' && rule.id.trim().length > 0
        ? rule.id.trim()
        : crypto.randomUUID(),
      action,
      sourceType,
      sourceValue: sourceType === 'all' ? '' : sourceValue,
      targetType,
      targetValue: targetType === 'all' ? '' : targetValue,
      bidirectional: rule.bidirectional !== false,
      enabled: rule.enabled !== false,
    };
  }

  __pruneClientIsolationRules(config) {
    const isolation = this.__normalizeClientIsolation(config);
    const seen = new Set();

    isolation.rules = isolation.rules.filter((rule) => {
      if (rule.sourceType === 'client' && !config.clients[rule.sourceValue]) {
        return false;
      }

      if (rule.targetType === 'client' && !config.clients[rule.targetValue]) {
        return false;
      }

      const dedupeKey = [
        rule.action,
        rule.sourceType,
        rule.sourceValue,
        rule.targetType,
        rule.targetValue,
        rule.bidirectional,
        rule.enabled,
      ].join(':');
      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    });

    return isolation;
  }

  async __getValidatedUplinkConfig(configInput = null) {
    const config = configInput || await this.getConfig();
    const settings = this.__validateUplinkSettings(
      this.__getEffectiveUplinkSettings(config, this.__normalizeUplinkSettings(config))
    );

    if (!settings.enabled) {
      return null;
    }

    const configPath = settings.configPath;
    let configText = await fs.readFile(configPath, 'utf8').catch((err) => {
      throw new ServerError(`Unable to read uplink config (${configPath}): ${err.message}`, 400);
    });

    if (!hasUplinkConfigTableOff(configText)) {
      configText = ensureUplinkConfigTableOff(configText);
      await fs.writeFile(configPath, `${configText.trimEnd()}\n`, { mode: 0o600 }).catch((err) => {
        throw new ServerError(`Unable to update uplink config (${configPath}): ${err.message}`, 400);
      });
    }

    return {
      id: settings.id,
      name: settings.name,
      configPath,
      configPathShell: this.__escapeShellArgument(configPath),
      interfaceName: settings.interfaceName,
      table: settings.table,
      sourceRules: settings.sourceRules,
      destinationDomains: settings.destinationDomains,
    };
  }

  async __getValidatedUplinkConfigs(configInput = null) {
    const config = configInput || await this.getConfig();
    const settingsList = this.__validateUplinkSettingsList(
      this.__normalizeUplinkSettingsList(config)
        .map((uplink) => this.__getEffectiveUplinkSettings(config, uplink))
    );
    const uplinks = [];

    for (const settings of settingsList) {
      if (!settings.enabled) {
        continue;
      }

      const configText = await fs.readFile(settings.configPath, 'utf8').catch((err) => {
        throw new ServerError(`Unable to read uplink config (${settings.configPath}): ${err.message}`, 400);
      });

      if (!hasUplinkConfigTableOff(configText)) {
        const normalizedConfigText = ensureUplinkConfigTableOff(configText);
        await fs.writeFile(settings.configPath, `${normalizedConfigText.trimEnd()}\n`, { mode: 0o600 }).catch((err) => {
          throw new ServerError(`Unable to update uplink config (${settings.configPath}): ${err.message}`, 400);
        });
      }

      uplinks.push({
        id: settings.id,
        name: settings.name,
        configPath: settings.configPath,
        configPathShell: this.__escapeShellArgument(settings.configPath),
        interfaceName: settings.interfaceName,
        table: settings.table,
        sourceRules: settings.sourceRules,
        destinationDomains: settings.destinationDomains,
      });
    }

    return uplinks;
  }

  async __removeUplinkPolicyRouting(uplink, uplinkIndex) {
    for (const [index, sourceRule] of uplink.sourceRules.entries()) {
      const priority = this.__getUplinkRulePriority(uplinkIndex, index);
      await Util.exec(`ip -4 rule del pref ${priority} from ${sourceRule} table ${uplink.table}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -D FORWARD -i wg0 -o ${uplink.interfaceName} -s ${sourceRule} -j ACCEPT`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t nat -D POSTROUTING -s ${sourceRule} -o ${uplink.interfaceName} -j MASQUERADE`, {
        log: false,
      }).catch(() => {});
    }

    const mark = this.__getUplinkMarkValue(uplinkIndex);
    const markPriority = this.__getUplinkMarkRulePriority(uplinkIndex);
    const domainSetName = this.__getUplinkDomainSetName(uplink);

    await Util.exec(`ip -4 rule del pref ${markPriority} fwmark ${mark} table ${uplink.table}`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -t mangle -D WG_EASY_UPLINK_DOMAINS -m mark --mark 0x0 -m set --match-set ${domainSetName} dst -j MARK --set-mark ${mark}`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -D FORWARD -i wg0 -o ${uplink.interfaceName} -m mark --mark ${mark} -j ACCEPT`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -t nat -D POSTROUTING -m mark --mark ${mark} -o ${uplink.interfaceName} -j MASQUERADE`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -D FORWARD -i ${uplink.interfaceName} -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`ipset destroy ${domainSetName}`, {
      log: false,
    }).catch(() => {});

    for (const categoryRule of Array.isArray(uplink.categoryRules) ? uplink.categoryRules : []) {
      await Util.exec(`iptables -t mangle -D WG_EASY_UPLINK_DOMAINS -m mark --mark 0x0 -s ${categoryRule.sourceRule} -m set --match-set ${categoryRule.setName} dst -j MARK --set-mark ${mark}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ipset destroy ${categoryRule.setName}`, {
        log: false,
      }).catch(() => {});
    }

    await Util.exec(`ip -4 route flush table ${uplink.table}`, {
      log: false,
    }).catch(() => {});
  }

  async __ensureUplinkDomainChainExists(chainName) {
    await Util.exec(`iptables -t mangle -N ${chainName}`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -t mangle -F ${chainName}`, {
      log: false,
    }).catch(() => {});
  }

  async __resolveDestinationDomains(destinationDomains) {
    const resolved = [];

    for (const domain of destinationDomains) {
      try {
        const records = await dns.lookup(domain, {
          all: true,
          family: 4,
          verbatim: true,
        });

        for (const record of records) {
          if (record && Util.isValidIPv4(record.address)) {
            resolved.push(record.address);
          }
        }
      } catch (err) {
        debug(`Failed to resolve uplink domain ${domain}: ${err.message}`);
      }
    }

    return [...new Set(resolved)];
  }

  async __syncUplinkDomainSet(uplink) {
    const domainSetName = this.__getUplinkDomainSetName(uplink);
    const resolvedAddresses = await this.__resolveDestinationDomains(uplink.destinationDomains);

    await Util.exec(`ipset create ${domainSetName} hash:ip family inet -exist`, {
      log: false,
    });
    await Util.exec(`ipset flush ${domainSetName}`, {
      log: false,
    });

    for (const address of resolvedAddresses) {
      await Util.exec(`ipset add ${domainSetName} ${address} -exist`, {
        log: false,
      });
    }

    return {
      setName: domainSetName,
      resolvedAddresses,
    };
  }

  async __syncRoutingCategorySet(category) {
    const setName = this.__getRoutingCategorySetName(category);
    const resolvedAddresses = await this.__resolveDestinationDomains(category.domains);

    await Util.exec(`ipset create ${setName} hash:ip family inet -exist`, {
      log: false,
    });
    await Util.exec(`ipset flush ${setName}`, {
      log: false,
    });

    for (const address of resolvedAddresses) {
      await Util.exec(`ipset add ${setName} ${address} -exist`, {
        log: false,
      });
    }

    return {
      setName,
      resolvedAddresses,
    };
  }

  __extractIpv4RouteCidrs(routes = []) {
    return [...new Set(
      routes
        .map((route) => {
          const match = String(route).trim().match(/^(\d+\.\d+\.\d+\.\d+(?:\/\d+)?)\b/);
          if (!match) {
            return null;
          }

          try {
            return this.__parseIpv4Cidr(match[1]).canonical;
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    )];
  }

  async __getProtectedUplinkCidrs(config, mainRoutes = []) {
    const runtime = await this.__loadRuntimeSettings();
    const manualProtectedCidrs = this.__normalizeUplinkProtectedCidrs(config);
    const protectedCidrs = [
      ...manualProtectedCidrs,
      this.__getRuntimeNetworkCidr(runtime),
      ...this.__extractIpv4RouteCidrs(mainRoutes),
    ];

    const resolvedHost = this.__resolvedWgHost || await this.__resolveWgHost({ required: false });
    if (Util.isValidIPv4(resolvedHost)) {
      protectedCidrs.push(`${resolvedHost}/32`);
    }

    return [...new Set(
      protectedCidrs
        .map((cidr) => this.__parseIpv4Cidr(cidr).canonical)
        .filter(Boolean)
    )];
  }

  async __syncProtectedUplinkSet(protectedCidrs) {
    const setName = 'awg_uplink_protected';

    await Util.exec(`ipset create ${setName} hash:net family inet -exist`, {
      log: false,
    });
    await Util.exec(`ipset flush ${setName}`, {
      log: false,
    });

    for (const cidr of protectedCidrs) {
      await Util.exec(`ipset add ${setName} ${cidr} -exist`, {
        log: false,
      });
    }

    return setName;
  }

  __getDnsRoutingPaths() {
    return {
      configPath: path.join(WG_PATH, 'dnsmasq-uplink.conf'),
      pidPath: path.join(WG_PATH, 'dnsmasq-uplink.pid'),
      logPath: path.join(WG_PATH, 'dnsmasq-uplink.log'),
    };
  }

  async __stopDnsRouting() {
    const { pidPath, configPath } = this.__getDnsRoutingPaths();
    let pid = null;

    try {
      pid = (await fs.readFile(pidPath, 'utf8')).trim();
    } catch {}

    if (pid) {
      await Util.exec(`kill ${pid}`, {
        log: false,
      }).catch(() => {});
    }

    await Util.exec(`pkill -f ${this.__escapeShellArgument(`dnsmasq --conf-file=${configPath}`)}`, {
      log: false,
    }).catch(() => {});

    await Util.exec('iptables -t nat -D PREROUTING -i wg0 -p udp --dport 53 -j REDIRECT --to-ports 53', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -t nat -D PREROUTING -i wg0 -p tcp --dport 53 -j REDIRECT --to-ports 53', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -D INPUT -i wg0 -p udp --dport 53 -j ACCEPT', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -D INPUT -i wg0 -p tcp --dport 53 -j ACCEPT', {
      log: false,
    }).catch(() => {});

    await fs.rm(pidPath, { force: true }).catch(() => {});
    await fs.rm(configPath, { force: true }).catch(() => {});
    this.__dnsRoutingRuntime = null;
  }

  async __isDnsRoutingProcessRunning() {
    const { pidPath, configPath } = this.__getDnsRoutingPaths();

    try {
      const pid = (await fs.readFile(pidPath, 'utf8')).trim();
      if (pid) {
        await Util.exec(`kill -0 ${pid}`, {
          log: false,
        });
        return true;
      }
    } catch {}

    try {
      await Util.exec(`pgrep -f ${this.__escapeShellArgument(`dnsmasq --conf-file=${configPath}`)}`, {
        log: false,
      });
      return true;
    } catch {}

    return false;
  }

  __buildDnsRoutingRuntimeState(config, dnsRouting, uplinks, routingCategories) {
    return {
      enabled: true,
      upstreams: [...dnsRouting.upstreams],
      uplinkIds: uplinks.map((uplink) => uplink.id),
      routingCategoryIds: routingCategories.map((category) => category.id),
      listenAddress: config.server.address,
    };
  }

  __isSameDnsRoutingRuntime(nextState) {
    if (!this.__dnsRoutingRuntime || !nextState) {
      return false;
    }

    return JSON.stringify(this.__dnsRoutingRuntime) === JSON.stringify(nextState);
  }

  async __writeDnsRoutingConfig(config, dnsRouting, uplinks, routingCategories) {
    const { configPath, pidPath, logPath } = this.__getDnsRoutingPaths();
    const lines = [
      '# Managed by amnezia-wg-easy. Do not edit manually.',
      'bind-interfaces',
      'interface=wg0',
      `listen-address=${config.server.address}`,
      'no-hosts',
      'cache-size=1000',
      `pid-file=${pidPath}`,
      'log-queries=extra',
      `log-facility=${logPath}`,
    ];

    if (dnsRouting.upstreams.length > 0) {
      lines.push('no-resolv');
      for (const upstream of dnsRouting.upstreams) {
        lines.push(`server=${upstream}`);
      }
    }

    for (const uplink of uplinks) {
      if (!Array.isArray(uplink.destinationDomains) || uplink.destinationDomains.length === 0) {
        continue;
      }

      const setName = this.__getUplinkDomainSetName(uplink);
      for (const domain of uplink.destinationDomains) {
        lines.push(`ipset=/${domain}/${setName}`);
      }
    }

    for (const category of routingCategories) {
      if (!Array.isArray(category.domains) || category.domains.length === 0) {
        continue;
      }

      const setName = this.__getRoutingCategorySetName(category);
      for (const domain of category.domains) {
        lines.push(`ipset=/${domain}/${setName}`);
      }
    }

    await fs.writeFile(configPath, `${lines.join('\n')}\n`, {
      mode: 0o600,
    });

    return {
      configPath,
      pidPath,
      logPath,
    };
  }

  async __startDnsRouting(config, dnsRouting, uplinks, routingCategories) {
    const { configPath } = await this.__writeDnsRoutingConfig(config, dnsRouting, uplinks, routingCategories);
    await Util.exec('iptables -I INPUT 1 -i wg0 -p udp --dport 53 -j ACCEPT', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -I INPUT 1 -i wg0 -p tcp --dport 53 -j ACCEPT', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -t nat -I PREROUTING 1 -i wg0 -p udp --dport 53 -j REDIRECT --to-ports 53', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -t nat -I PREROUTING 1 -i wg0 -p tcp --dport 53 -j REDIRECT --to-ports 53', {
      log: false,
    }).catch(() => {});

    try {
      await Util.exec(`dnsmasq --conf-file=${this.__escapeShellArgument(configPath)}`);
    } catch (err) {
      await this.__stopDnsRouting().catch(() => {});
      throw new ServerError(`Failed to start VPN DNS routing: ${err.message}`, 400);
    }

    this.__dnsRoutingRuntime = this.__buildDnsRoutingRuntimeState(config, dnsRouting, uplinks, routingCategories);
  }

  async __syncDnsRouting(config = null) {
    this.__dnsRoutingSyncPromise = this.__dnsRoutingSyncPromise.catch(() => {}).then(async () => {
      const resolvedConfig = config || await this.getConfig();
      const dnsRouting = this.__validateDnsRoutingSettings(this.__normalizeDnsRoutingSettings(resolvedConfig));
      const uplinks = this.__validateUplinkSettingsList(this.__normalizeUplinkSettingsList(resolvedConfig))
        .filter((uplink) => uplink.enabled);
      const routingCategories = this.__validateRoutingCategories(resolvedConfig)
        .filter((category) => category.enabled);

      if (!dnsRouting.enabled) {
        await this.__stopDnsRouting();
        return;
      }

      const nextRuntime = this.__buildDnsRoutingRuntimeState(resolvedConfig, dnsRouting, uplinks, routingCategories);
      if (this.__isSameDnsRoutingRuntime(nextRuntime) && await this.__isDnsRoutingProcessRunning()) {
        return;
      }

      await this.__stopDnsRouting();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this.__startDnsRouting(resolvedConfig, dnsRouting, uplinks, routingCategories);
    });

    return this.__dnsRoutingSyncPromise;
  }

  __formatUplinkCommandError(prefix, err) {
    const message = err && err.message ? err.message : String(err);

    if (message.includes('resolvconf: command not found')) {
      return new ServerError(`${prefix}: resolvconf is missing. Rebuild the container with openresolv installed or remove DNS from awg1.conf.`, 400);
    }

    return new ServerError(`${prefix}: ${message}`, 400);
  }

  async __prepareUplinkConfig(uplink) {
    const rawConfigText = await fs.readFile(uplink.configPath, 'utf8').catch((err) => {
      throw new ServerError(`Unable to read uplink config (${uplink.configPath}): ${err.message}`, 400);
    });
    const sanitizedConfigText = rawConfigText
      .split(/\r?\n/)
      .filter((line) => !/^\s*DNS\s*=.*$/i.test(line))
      .join('\n');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'awg-uplink-'));
    const tempConfigPath = path.join(tempDir, `${uplink.interfaceName}.conf`);
    await fs.writeFile(tempConfigPath, `${sanitizedConfigText.trimEnd()}\n`, {
      mode: 0o600,
    });
    await fs.chmod(tempConfigPath, 0o600);

    return {
      tempDir,
      tempConfigPath,
      tempConfigPathShell: this.__escapeShellArgument(tempConfigPath),
    };
  }

  async __bringUpUplinkInterface(uplink) {
    const prepared = await this.__prepareUplinkConfig(uplink);

    try {
      await Util.exec(`ip link show ${uplink.interfaceName}`, {
        log: false,
      }).then(() => Util.exec(`ip link delete dev ${uplink.interfaceName}`, {
        log: false,
      })).catch(() => {});

      await Util.exec(`wg-quick up ${prepared.tempConfigPathShell}`).catch((err) => {
        throw this.__formatUplinkCommandError(`Failed to start uplink interface ${uplink.interfaceName}`, err);
      });
    } finally {
      await fs.rm(prepared.tempDir, {
        force: true,
        recursive: true,
      }).catch(() => {});
    }
  }

  async __getMainTableRoutes() {
    const output = await Util.exec('ip -4 route show table main', {
      log: false,
    });

    return [...new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('default '))
        .filter((line) => !line.startsWith('local '))
        .filter((line) => !line.startsWith('broadcast '))
        .filter((line) => !line.startsWith('unreachable '))
        .filter((line) => !line.startsWith('prohibit '))
        .filter((line) => !line.startsWith('blackhole '))
    )];
  }

  async __ensureIsolationChainExists(chainName) {
    await Util.exec(`iptables -N ${chainName}`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -F ${chainName}`, {
      log: false,
    }).catch(() => {});
  }

  __getIsolationSelectorCidrs(config, selectorType, selectorValue) {
    if (selectorType === 'all') {
      return [null];
    }

    if (selectorType === 'client') {
      const client = config.clients[selectorValue];
      return client ? [`${client.address}/32`] : [];
    }

    if (selectorType === 'group') {
      return Object.values(config.clients)
        .filter((client) => Array.isArray(client.aclGroups) && client.aclGroups.includes(selectorValue))
        .map((client) => `${client.address}/32`);
    }

    if (selectorType === 'cidr') {
      return [this.__parseIpv4Cidr(selectorValue).canonical];
    }

    return [];
  }

  async __appendIsolationRule(chainName, sourceCidr, targetCidr, action) {
    const targetAction = action === 'deny' ? 'DROP' : 'ACCEPT';
    const args = [`iptables -A ${chainName}`];

    if (sourceCidr) {
      args.push(`-s ${sourceCidr}`);
    }

    if (targetCidr) {
      args.push(`-d ${targetCidr}`);
    } else {
      args.push('-o wg0');
    }

    args.push(`-j ${targetAction}`);
    await Util.exec(args.join(' '));
  }

  async __syncClientIsolationFirewall(config = null) {
    const chainName = 'WG_EASY_ISOLATION';
    const resolvedConfig = config || await this.getConfig();
    const isolation = this.__pruneClientIsolationRules(resolvedConfig);

    await Util.exec(`iptables -D FORWARD -i wg0 -j ${chainName}`, {
      log: false,
    }).catch(() => {});

    if (!isolation.enabled) {
      await Util.exec(`iptables -F ${chainName}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -X ${chainName}`, {
        log: false,
      }).catch(() => {});
      return;
    }

    await this.__ensureIsolationChainExists(chainName);

    for (const rule of isolation.rules) {
      if (!rule.enabled) {
        continue;
      }

      const sourceCidrs = this.__getIsolationSelectorCidrs(resolvedConfig, rule.sourceType, rule.sourceValue);
      const targetCidrs = this.__getIsolationSelectorCidrs(resolvedConfig, rule.targetType, rule.targetValue);

      for (const sourceCidr of sourceCidrs) {
        for (const targetCidr of targetCidrs) {
          if (sourceCidr && targetCidr && sourceCidr === targetCidr) {
            continue;
          }

          await this.__appendIsolationRule(chainName, sourceCidr, targetCidr, rule.action);

          if (rule.bidirectional && !(sourceCidr === null && targetCidr === null)) {
            await this.__appendIsolationRule(chainName, targetCidr, sourceCidr, rule.action);
          }
        }
      }
    }

    await Util.exec(`iptables -A ${chainName} -o wg0 -j DROP`);
    await Util.exec(`iptables -A ${chainName} -j RETURN`);
    await Util.exec(`iptables -I FORWARD 1 -i wg0 -j ${chainName}`, {
      log: false,
    });
  }

  async __configureUplinkRouting(config = null) {
    const uplinks = await this.__getValidatedUplinkConfigs(config);
    if (uplinks.length === 0) {
      return;
    }

    const resolvedConfig = config || await this.getConfig();
    const mainRoutes = await this.__getMainTableRoutes();
    const protectedCidrs = await this.__getProtectedUplinkCidrs(resolvedConfig, mainRoutes);
    const runtimeUplinks = [];
    const domainChainName = 'WG_EASY_UPLINK_DOMAINS';
    const protectedSetName = await this.__syncProtectedUplinkSet(protectedCidrs);
    const protectedMark = this.__getProtectedUplinkMarkValue();
    const protectedPriority = this.__getProtectedUplinkRulePriority();

    try {
      await Util.exec(`ip -4 rule add pref ${protectedPriority} fwmark ${protectedMark} table main`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t mangle -D PREROUTING -i wg0 -m set --match-set ${protectedSetName} dst -j MARK --set-mark ${protectedMark}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t mangle -I PREROUTING 1 -i wg0 -m set --match-set ${protectedSetName} dst -j MARK --set-mark ${protectedMark}`);
      await Util.exec(`iptables -t mangle -D PREROUTING -i wg0 -j ${domainChainName}`, {
        log: false,
      }).catch(() => {});
      await this.__ensureUplinkDomainChainExists(domainChainName);

      for (const [uplinkIndex, uplink] of uplinks.entries()) {
        const routingCategories = this.__getEnabledRoutingCategoriesForUplink(resolvedConfig, uplink.id);
        if (uplink.sourceRules.length === 0 && uplink.destinationDomains.length === 0 && routingCategories.length === 0) {
          // eslint-disable-next-line no-console
          console.warn(`Uplink "${uplink.name}" is enabled but has neither source rules nor destination domains; the tunnel will start without active policy rules.`);
        }

        await Util.exec(`wg-quick down ${uplink.interfaceName}`, {
          log: false,
        }).catch(() => {});
        await this.__bringUpUplinkInterface(uplink);
        await this.__removeUplinkPolicyRouting(uplink, uplinkIndex);

        for (const route of mainRoutes) {
          await Util.exec(`ip -4 route add table ${uplink.table} ${route}`, {
            log: false,
          }).catch(() => {});
        }

        await Util.exec(`ip -4 route replace default dev ${uplink.interfaceName} table ${uplink.table}`);
        const mark = this.__getUplinkMarkValue(uplinkIndex);
        const markPriority = this.__getUplinkMarkRulePriority(uplinkIndex);

        if (uplink.destinationDomains.length > 0 || routingCategories.length > 0) {
          await Util.exec(`ip -4 rule add pref ${markPriority} fwmark ${mark} table ${uplink.table}`);
          await Util.exec(`iptables -A FORWARD -i wg0 -o ${uplink.interfaceName} -m mark --mark ${mark} -j ACCEPT`);
          await Util.exec(`iptables -t nat -A POSTROUTING -m mark --mark ${mark} -o ${uplink.interfaceName} -j MASQUERADE`);
        }

        if (uplink.destinationDomains.length > 0) {
          const { setName, resolvedAddresses } = await this.__syncUplinkDomainSet(uplink);
          await Util.exec(`iptables -t mangle -A ${domainChainName} -m mark --mark 0x0 -m set --match-set ${setName} dst -j MARK --set-mark ${mark}`);
          debug(`Uplink domain routing enabled via ${uplink.interfaceName} for ${uplink.destinationDomains.length} domain(s), ${resolvedAddresses.length} IPv4 target(s).`);
        }

        const categoryRules = [];
        for (const category of routingCategories) {
          const { setName, resolvedAddresses } = await this.__syncRoutingCategorySet(category);

          for (const clientId of category.clientIds) {
            const client = (config || await this.getConfig()).clients[clientId];
            if (!client || !client.address) {
              continue;
            }

            const sourceRule = `${client.address}/32`;
            await Util.exec(`iptables -t mangle -A ${domainChainName} -m mark --mark 0x0 -s ${sourceRule} -m set --match-set ${setName} dst -j MARK --set-mark ${mark}`);
            categoryRules.push({
              categoryId: category.id,
              sourceRule,
              setName,
            });
          }

          debug(`Uplink category routing enabled via ${uplink.interfaceName} for category "${category.name}" with ${category.clientIds.length} client(s) and ${resolvedAddresses.length} IPv4 target(s).`);
        }

        await Util.exec(`iptables -A FORWARD -i ${uplink.interfaceName} -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`, {
          log: false,
        }).catch(() => {});

        for (const [ruleIndex, sourceRule] of uplink.sourceRules.entries()) {
          const priority = this.__getUplinkRulePriority(uplinkIndex, ruleIndex);
          await Util.exec(`ip -4 rule add pref ${priority} from ${sourceRule} table ${uplink.table}`);
          await Util.exec(`iptables -A FORWARD -i wg0 -o ${uplink.interfaceName} -s ${sourceRule} -j ACCEPT`);
          await Util.exec(`iptables -t nat -A POSTROUTING -s ${sourceRule} -o ${uplink.interfaceName} -j MASQUERADE`);
        }

        runtimeUplinks.push({
          ...uplink,
          categoryRules,
        });
        debug(`Uplink routing enabled via ${uplink.interfaceName} (table ${uplink.table}) for ${uplink.sourceRules.length} source rule(s).`);
      }

      await Util.exec(`iptables -t mangle -A ${domainChainName} -j RETURN`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t mangle -I PREROUTING 1 -i wg0 -j ${domainChainName}`, {
        log: false,
      });
    } catch (err) {
      for (let index = runtimeUplinks.length - 1; index >= 0; index -= 1) {
        const uplink = runtimeUplinks[index];
        await this.__removeUplinkPolicyRouting(uplink, index).catch(() => {});
        await Util.exec(`wg-quick down ${uplink.interfaceName}`, {
          log: false,
        }).catch(() => {});
      }
      await Util.exec(`iptables -t mangle -F ${domainChainName}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t mangle -X ${domainChainName}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`iptables -t mangle -D PREROUTING -i wg0 -m set --match-set ${protectedSetName} dst -j MARK --set-mark ${protectedMark}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ip -4 rule del pref ${protectedPriority} fwmark ${protectedMark} table main`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ipset destroy ${protectedSetName}`, {
        log: false,
      }).catch(() => {});
      throw err;
    }

    this.__uplinkRuntime = runtimeUplinks;
  }

  async __teardownUplinkRouting() {
    const uplinks = Array.isArray(this.__uplinkRuntime) ? this.__uplinkRuntime : [];
    const protectedSetName = 'awg_uplink_protected';
    const protectedMark = this.__getProtectedUplinkMarkValue();
    const protectedPriority = this.__getProtectedUplinkRulePriority();
    if (uplinks.length === 0) {
      await Util.exec(`iptables -t mangle -D PREROUTING -i wg0 -m set --match-set ${protectedSetName} dst -j MARK --set-mark ${protectedMark}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ip -4 rule del pref ${protectedPriority} fwmark ${protectedMark} table main`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ipset destroy ${protectedSetName}`, {
        log: false,
      }).catch(() => {});
      await Util.exec('iptables -t mangle -D PREROUTING -i wg0 -j WG_EASY_UPLINK_DOMAINS', {
        log: false,
      }).catch(() => {});
      await Util.exec('iptables -t mangle -F WG_EASY_UPLINK_DOMAINS', {
        log: false,
      }).catch(() => {});
      await Util.exec('iptables -t mangle -X WG_EASY_UPLINK_DOMAINS', {
        log: false,
      }).catch(() => {});
      return;
    }

    for (let index = uplinks.length - 1; index >= 0; index -= 1) {
      const uplink = uplinks[index];
      await this.__removeUplinkPolicyRouting(uplink, index);
      await Util.exec(`wg-quick down ${uplink.interfaceName}`, {
        log: false,
      }).catch(() => {});
    }

    await Util.exec('iptables -t mangle -D PREROUTING -i wg0 -j WG_EASY_UPLINK_DOMAINS', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -t mangle -F WG_EASY_UPLINK_DOMAINS', {
      log: false,
    }).catch(() => {});
    await Util.exec('iptables -t mangle -X WG_EASY_UPLINK_DOMAINS', {
      log: false,
    }).catch(() => {});
    await Util.exec(`iptables -t mangle -D PREROUTING -i wg0 -m set --match-set ${protectedSetName} dst -j MARK --set-mark ${protectedMark}`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`ip -4 rule del pref ${protectedPriority} fwmark ${protectedMark} table main`, {
      log: false,
    }).catch(() => {});
    await Util.exec(`ipset destroy ${protectedSetName}`, {
      log: false,
    }).catch(() => {});

    this.__uplinkRuntime = [];
  }

  __isSameUplinkConfig(current, next) {
    if (!current || !next) {
      return false;
    }

    return current.configPath === next.configPath
      && current.interfaceName === next.interfaceName
      && String(current.table) === String(next.table)
      && JSON.stringify(current.sourceRules) === JSON.stringify(next.sourceRules)
      && JSON.stringify(current.destinationDomains || []) === JSON.stringify(next.destinationDomains || []);
  }

  __isSameUplinkConfigList(currentList, nextList) {
    if (!Array.isArray(currentList) || !Array.isArray(nextList) || currentList.length !== nextList.length) {
      return false;
    }

    return currentList.every((current, index) => this.__isSameUplinkConfig(current, nextList[index]));
  }

  async __getInterfaceIpv4Address(interfaceName) {
    const output = await Util.exec(`ip -4 -o addr show dev ${interfaceName}`, {
      log: false,
    }).catch(() => '');

    const match = output.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\/\d+\b/);
    return match ? match[1] : null;
  }

  async __getUplinkPeerState(interfaceName) {
    const dump = await Util.exec(`wg show ${interfaceName} dump`, {
      log: false,
    }).catch(() => '');

    const peerLine = dump
      .trim()
      .split('\n')
      .slice(1)
      .find(Boolean);

    if (!peerLine) {
      return {
        latestHandshakeAt: null,
        transferRx: 0,
        transferTx: 0,
      };
    }

    const [
      publicKey,
      preSharedKey,
      endpoint,
      allowedIps,
      latestHandshakeAt,
      transferRx,
      transferTx,
    ] = peerLine.split('\t');

    return {
      publicKey,
      preSharedKey,
      endpoint,
      allowedIps,
      latestHandshakeAt: latestHandshakeAt && latestHandshakeAt !== '0'
        ? new Date(Number(`${latestHandshakeAt}000`))
        : null,
      transferRx: Number(transferRx || 0),
      transferTx: Number(transferTx || 0),
    };
  }

  async __runUplinkProbe(interfaceName, sourceAddress) {
    const testTable = 59999;
    const testPriority = 10999;

    await Util.exec(`ip -4 route replace table ${testTable} default dev ${interfaceName}`, {
      log: false,
    });
    await Util.exec(`ip -4 rule add pref ${testPriority} from ${sourceAddress}/32 table ${testTable}`, {
      log: false,
    }).catch(() => {});

    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({
          host: '1.1.1.1',
          port: 443,
          localAddress: sourceAddress,
        });

        const timer = setTimeout(() => {
          socket.destroy(new Error('Timeout'));
        }, 5000);

        socket.on('connect', () => {
          clearTimeout(timer);
          socket.end();
          resolve();
        });

        socket.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        socket.on('close', () => {
          clearTimeout(timer);
        });
      });

      return {
        connected: true,
        error: null,
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message || String(err),
      };
    } finally {
      await Util.exec(`ip -4 rule del pref ${testPriority} from ${sourceAddress}/32 table ${testTable}`, {
        log: false,
      }).catch(() => {});
      await Util.exec(`ip -4 route flush table ${testTable}`, {
        log: false,
      }).catch(() => {});
    }
  }

  async __syncUplinkRouting(config = null) {
    const desiredUplinks = await this.__getValidatedUplinkConfigs(config);

    if (desiredUplinks.length === 0) {
      await this.__teardownUplinkRouting().catch((err) => {
        debug(`Failed to tear down uplink routing: ${err.message}`);
      });
      return;
    }

    if (this.__isSameUplinkConfigList(this.__uplinkRuntime, desiredUplinks)) {
      return;
    }

    await this.__teardownUplinkRouting().catch((err) => {
      debug(`Failed to tear down uplink routing: ${err.message}`);
    });
    await this.__configureUplinkRouting(config);
  }

  async __refreshRuntimeUplinkDomains() {
    const runtimeUplinks = Array.isArray(this.__uplinkRuntime) ? this.__uplinkRuntime : [];

    for (const uplink of runtimeUplinks) {
      if (!Array.isArray(uplink.destinationDomains) || uplink.destinationDomains.length === 0) {
        continue;
      }

      try {
        const { resolvedAddresses } = await this.__syncUplinkDomainSet(uplink);
        debug(`Refreshed uplink domain set for ${uplink.interfaceName}: ${resolvedAddresses.length} IPv4 target(s).`);
      } catch (err) {
        debug(`Failed to refresh uplink domain set for ${uplink.interfaceName}: ${err.message}`);
      }

      const refreshedCategorySetNames = new Set();
      for (const categoryRule of Array.isArray(uplink.categoryRules) ? uplink.categoryRules : []) {
        if (refreshedCategorySetNames.has(categoryRule.setName)) {
          continue;
        }

        const config = await this.getConfig();
        const category = this.__validateRoutingCategories(config)
          .find((candidate) => candidate.id === categoryRule.categoryId);
        if (!category) {
          continue;
        }

        try {
          const { resolvedAddresses } = await this.__syncRoutingCategorySet(category);
          refreshedCategorySetNames.add(categoryRule.setName);
          debug(`Refreshed routing category set for ${category.name}: ${resolvedAddresses.length} IPv4 target(s).`);
        } catch (err) {
          debug(`Failed to refresh routing category set for ${category.name}: ${err.message}`);
        }
      }
    }
  }

  __escapePrometheusLabelValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"');
  }

  __assertValidRestoreConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new ServerError('Invalid backup format', 400);
    }

    if (!config.server || typeof config.server !== 'object' || Array.isArray(config.server)) {
      throw new ServerError('Invalid backup format', 400);
    }

    if (!config.clients || typeof config.clients !== 'object' || Array.isArray(config.clients)) {
      throw new ServerError('Invalid backup format', 400);
    }

    if ('clientIsolation' in config) {
      if (!config.clientIsolation || typeof config.clientIsolation !== 'object' || Array.isArray(config.clientIsolation)) {
        throw new ServerError('Invalid backup format', 400);
      }

      if ('rules' in config.clientIsolation && !Array.isArray(config.clientIsolation.rules)) {
        throw new ServerError('Invalid backup format', 400);
      }
    }

    if ('uplink' in config) {
      if (!config.uplink || typeof config.uplink !== 'object' || Array.isArray(config.uplink)) {
        throw new ServerError('Invalid backup format', 400);
      }

      if ('sourceRules' in config.uplink && !Array.isArray(config.uplink.sourceRules) && typeof config.uplink.sourceRules !== 'string') {
        throw new ServerError('Invalid backup format', 400);
      }

      if ('destinationDomains' in config.uplink && !Array.isArray(config.uplink.destinationDomains) && typeof config.uplink.destinationDomains !== 'string') {
        throw new ServerError('Invalid backup format', 400);
      }
    }

    if ('uplinks' in config) {
      if (!Array.isArray(config.uplinks)) {
        throw new ServerError('Invalid backup format', 400);
      }

      for (const uplink of config.uplinks) {
        if (!uplink || typeof uplink !== 'object' || Array.isArray(uplink)) {
          throw new ServerError('Invalid backup format', 400);
        }

        if ('sourceRules' in uplink && !Array.isArray(uplink.sourceRules) && typeof uplink.sourceRules !== 'string') {
          throw new ServerError('Invalid backup format', 400);
        }

        if ('destinationDomains' in uplink && !Array.isArray(uplink.destinationDomains) && typeof uplink.destinationDomains !== 'string') {
          throw new ServerError('Invalid backup format', 400);
        }
      }
    }

    if ('uplinkProtectedCidrs' in config && !Array.isArray(config.uplinkProtectedCidrs) && typeof config.uplinkProtectedCidrs !== 'string') {
      throw new ServerError('Invalid backup format', 400);
    }

    if ('dnsRouting' in config) {
      if (!config.dnsRouting || typeof config.dnsRouting !== 'object' || Array.isArray(config.dnsRouting)) {
        throw new ServerError('Invalid backup format', 400);
      }

      if ('upstreams' in config.dnsRouting && !Array.isArray(config.dnsRouting.upstreams) && typeof config.dnsRouting.upstreams !== 'string') {
        throw new ServerError('Invalid backup format', 400);
      }
    }

    for (const field of ['privateKey', 'publicKey', 'address']) {
      if (typeof config.server[field] !== 'string' || config.server[field].length === 0) {
        throw new ServerError('Invalid backup format', 400);
      }
    }

    for (const client of Object.values(config.clients)) {
      if (!client || typeof client !== 'object' || Array.isArray(client)) {
        throw new ServerError('Invalid backup format', 400);
      }

      if (typeof client.name !== 'string' || typeof client.address !== 'string' || typeof client.publicKey !== 'string') {
        throw new ServerError('Invalid backup format', 400);
      }

      if (typeof client.enabled !== 'boolean') {
        throw new ServerError('Invalid backup format', 400);
      }

      if ('aclGroups' in client && !Array.isArray(client.aclGroups) && typeof client.aclGroups !== 'string') {
        throw new ServerError('Invalid backup format', 400);
      }
    }
  }

  async __fetchPublicIp(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let req;
      const finish = (callback, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => {
        if (req) {
          req.destroy(new Error('Timeout'));
          return;
        }
        finish(reject, new Error('Timeout'));
      }, 5000);

      req = https.get(url, {
        headers: {
          'User-Agent': 'amnezia-wg-easy',
        },
      }, (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume();
          finish(reject, new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          const text = body.trim();
          const ipv4 = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
          if (ipv4) {
            finish(resolve, ipv4[0]);
            return;
          }

          const ipv6 = text.match(/\b(?:[A-Fa-f0-9:]+:+)+[A-Fa-f0-9]+\b/);
          if (ipv6) {
            finish(resolve, ipv6[0]);
            return;
          }

          finish(reject, new Error('Response does not contain IP address'));
        });
      });

      req.on('error', (err) => {
        finish(reject, err);
      });
      req.setTimeout(5000, () => {
        req.destroy(new Error('Timeout'));
      });
    });
  }

  async __resolveWgHost({ required = false } = {}) {
    const configuredHost = await this.__getConfiguredWgHost();
    if (!configuredHost) {
      this.__resolvedWgHost = null;
      if (required) {
        throw new Error('WG_HOST is not configured yet.');
      }
      return null;
    }

    if (configuredHost.toLowerCase() !== 'auto') {
      this.__resolvedWgHost = configuredHost;
      return this.__resolvedWgHost;
    }

    const providers = [
      'https://2ip.ru',
      'https://ifconfig.me/ip',
      'https://api.ipify.org',
      'https://ipv4.icanhazip.com',
      'https://checkip.amazonaws.com',
      'https://ipinfo.io/ip',
      'https://v4.ident.me',
      'https://ipv4.seeip.org',
      'https://myexternalip.com/raw',
    ];

    for (const provider of providers) {
      try {
        const detectedIp = await this.__fetchPublicIp(provider);
        this.__resolvedWgHost = detectedIp;
        debug(`WG_HOST auto detected via ${provider}: ${detectedIp}`);
        // eslint-disable-next-line no-console
        console.log(`[WG_HOST] Auto-detected public IP via ${provider}: ${detectedIp}`);
        return this.__resolvedWgHost;
      } catch (err) {
        debug(`WG_HOST auto detection failed via ${provider}: ${err.message}`);
      }
    }

    if (required) {
      throw new Error('WG_HOST=auto but failed to detect public IP from all configured providers');
    }

    this.__resolvedWgHost = null;
    return null;
  }

  async __buildConfig() {
    return Promise.resolve().then(async () => {
      const runtime = await this.__loadRuntimeSettings();
      await this.__resolveWgHost({ required: false });

      debug('Loading configuration...');
      let config;
      try {
        config = await this.__configStore.getConfig();
        if (config) {
          debug('Configuration loaded from SQLite.');
        } else {
          config = await fs.readFile(path.join(WG_PATH, 'wg0.json'), 'utf8');
          config = JSON.parse(config);
          await this.__configStore.setConfig(config);
          debug('Configuration loaded from wg0.json and migrated to SQLite.');
        }
      } catch (err) {
        const privateKey = await Util.exec('wg genkey');
        const publicKey = await Util.exec(`echo ${privateKey} | wg pubkey`, {
          log: 'echo ***hidden*** | wg pubkey',
        });
        const address = runtime.wgDefaultAddress.replace('x', '1');

        const defaultUplink = this.__getDefaultUplinkSettings();

        config = {
          server: {
            privateKey,
            publicKey,
            address,
            jc: JC,
            jmin: JMIN,
            jmax: JMAX,
            s1: S1,
            s2: S2,
            h1: H1,
            h2: H2,
            h3: H3,
            h4: H4,
          },
          clients: {},
          clientIsolation: this.__getDefaultClientIsolation(),
          clientUplinkAssignments: {},
          uplinkProtectedCidrs: [],
          uplinks: [defaultUplink],
          uplink: { ...defaultUplink },
        };
        await this.__configStore.setConfig(config);
        debug('Configuration generated.');
      }

      for (const client of Object.values(config.clients)) {
        this.__normalizeClientAclGroups(client);
      }
      this.__normalizeClientIsolation(config);
      this.__pruneClientIsolationRules(config);
      this.__normalizeUplinkSettingsList(config);
      this.__normalizeClientUplinkAssignments(config);
      this.__normalizeUplinkProtectedCidrs(config);
      this.__normalizeDnsRoutingSettings(config);

      return config;
    });
  }

  async __initializeConfigUnlocked() {
    await this.__loadRuntimeSettings();
    const config = await this.__buildConfig();

    await this.__saveConfig(config);
    await Util.exec('wg-quick down wg0').catch(() => {});
    await Util.exec('wg-quick up wg0').catch((err) => {
      if (err && err.message && err.message.includes('Cannot find device "wg0"')) {
        throw new Error('WireGuard exited with the error: Cannot find device "wg0"\nThis usually means that your host\'s kernel does not support WireGuard!');
      }

      throw err;
    });
    await this.__syncConfig();
    await this.__syncClientIsolationFirewall(config);
    await this.__configureUplinkRouting(config);
    await this.__syncDnsRouting(config);

    this.__configPromise = config;
    return config;
  }

  async __getConfigUnlocked() {
    if (this.__configPromise) {
      return this.__configPromise;
    }

    return this.__initializeConfigUnlocked();
  }

  async getConfig() {
    if (this.__configPromise) {
      return this.__configPromise;
    }

    if (!this.__configInitializingPromise) {
      this.__configInitializingPromise = this.__runLifecycleExclusive(async () => {
        if (this.__configPromise) {
          return this.__configPromise;
        }

        return this.__initializeConfigUnlocked();
      }).finally(() => {
        this.__configInitializingPromise = null;
      });
    }

    return this.__configInitializingPromise;
  }

  async saveConfig() {
    return this.__runLifecycleExclusive(async () => {
      await this.__loadRuntimeSettings();
      const config = await this.__getConfigUnlocked();
      this.__pruneClientIsolationRules(config);
      this.__normalizeUplinkSettingsList(config);
      this.__normalizeClientUplinkAssignments(config);
      await this.__saveConfig(config);
      await this.__syncConfig();
      await this.__syncClientIsolationFirewall(config);
      await this.__syncUplinkRouting(config);
      await this.__syncDnsRouting(config);
      this.__configPromise = config;
      return config;
    });
  }

  async __saveConfig(config) {
    const runtime = await this.__loadRuntimeSettings();
    config.server.address = runtime.wgDefaultAddress.replace('x', '1');
    const postUp = this.__getRuntimePostUp(runtime);
    const postDown = this.__getRuntimePostDown(runtime);
    let result = `
# Note: Do not edit this file directly.
# Your changes will be overwritten!

# Server
[Interface]
PrivateKey = ${config.server.privateKey}
Address = ${config.server.address}/24
ListenPort = ${runtime.wgPort}
PreUp = ${WG_PRE_UP}
PostUp = ${postUp}
PreDown = ${WG_PRE_DOWN}
PostDown = ${postDown}
Jc = ${config.server.jc}
Jmin = ${config.server.jmin}
Jmax = ${config.server.jmax}
S1 = ${config.server.s1}
S2 = ${config.server.s2}
H1 = ${config.server.h1}
H2 = ${config.server.h2}
H3 = ${config.server.h3}
H4 = ${config.server.h4}
`;

    for (const [clientId, client] of Object.entries(config.clients)) {
      if (!client.enabled) continue;

      result += `

# Client: ${client.name} (${clientId})
[Peer]
PublicKey = ${client.publicKey}
${client.preSharedKey ? `PresharedKey = ${client.preSharedKey}\n` : ''
}AllowedIPs = ${client.address}/32`;
    }

    debug('Config saving...');
    await this.__configStore.setConfig(config);
    await fs.writeFile(path.join(WG_PATH, 'wg0.json'), JSON.stringify(config, false, 2), {
      mode: 0o660,
    });
    await fs.writeFile(path.join(WG_PATH, 'wg0.conf'), result, {
      mode: 0o600,
    });
    debug('Config saved.');
  }

  async __syncConfig() {
    debug('Config syncing...');
    await Util.exec('wg syncconf wg0 <(wg-quick strip wg0)');
    debug('Config synced.');
  }

  async getClients() {
    const config = await this.getConfig();
    const clients = Object.entries(config.clients).map(([clientId, client]) => ({
      id: clientId,
      name: client.name,
      enabled: client.enabled,
      address: client.address,
      aclGroups: Array.isArray(client.aclGroups) ? [...client.aclGroups] : [],
      publicKey: client.publicKey,
      createdAt: new Date(client.createdAt),
      updatedAt: new Date(client.updatedAt),
      expiredAt: client.expiredAt !== null
        ? new Date(client.expiredAt)
        : null,
      allowedIPs: client.allowedIPs,
      oneTimeLink: client.oneTimeLink ?? null,
      oneTimeLinkExpiresAt: client.oneTimeLinkExpiresAt ?? null,
      downloadableConfig: 'privateKey' in client,
      persistentKeepalive: null,
      latestHandshakeAt: null,
      transferRx: null,
      transferTx: null,
      endpoint: null,
    }));

    // Loop WireGuard status
    try {
      const dump = await Util.exec('wg show wg0 dump', {
        log: false,
      });
      dump
        .trim()
        .split('\n')
        .slice(1)
        .forEach((line) => {
          const [
            publicKey,
            preSharedKey, // eslint-disable-line no-unused-vars
            endpoint, // eslint-disable-line no-unused-vars
            allowedIps, // eslint-disable-line no-unused-vars
            latestHandshakeAt,
            transferRx,
            transferTx,
            persistentKeepalive,
          ] = line.split('\t');

          const client = clients.find((client) => client.publicKey === publicKey);
          if (!client) return;

          client.latestHandshakeAt = latestHandshakeAt === '0'
            ? null
            : new Date(Number(`${latestHandshakeAt}000`));
          client.endpoint = endpoint === '(none)' ? null : endpoint;
          client.transferRx = Number(transferRx);
          client.transferTx = Number(transferTx);
          client.persistentKeepalive = persistentKeepalive;
        });
    } catch (err) {
      debug(`Failed to get WireGuard dump: ${err.message}`);
    }

    return clients;
  }

  async getClient({ clientId }) {
    const config = await this.getConfig();
    const client = config.clients[clientId];
    if (!client) {
      throw new ServerError(`Client Not Found: ${clientId}`, 404);
    }

    return client;
  }

  async getClientConfiguration({ clientId }) {
    const config = await this.getConfig();
    const client = await this.getClient({ clientId });
    const defaultDns = await this.__getConfiguredDefaultDns();
    const runtime = await this.__loadRuntimeSettings();
    const dnsRouting = this.__normalizeDnsRoutingSettings(config);
    const clientDns = dnsRouting.enabled
      ? config.server.address
      : defaultDns;

    if (!this.__resolvedWgHost) {
      await this.__resolveWgHost({ required: true });
    }

    return `[Interface]
PrivateKey = ${client.privateKey ? `${client.privateKey}` : 'REPLACE_ME'}
Address = ${client.address}/24
${clientDns ? `DNS = ${clientDns}\n` : ''}\
${runtime.wgMtu ? `MTU = ${runtime.wgMtu}\n` : ''}\
Jc = ${config.server.jc}
Jmin = ${config.server.jmin}
Jmax = ${config.server.jmax}
S1 = ${config.server.s1}
S2 = ${config.server.s2}
H1 = ${config.server.h1}
H2 = ${config.server.h2}
H3 = ${config.server.h3}
H4 = ${config.server.h4}

[Peer]
PublicKey = ${config.server.publicKey}
${client.preSharedKey ? `PresharedKey = ${client.preSharedKey}\n` : ''
}AllowedIPs = ${runtime.wgAllowedIps}
PersistentKeepalive = ${runtime.wgPersistentKeepalive}
Endpoint = ${this.__resolvedWgHost}:${runtime.wgConfigPort}`;
  }

  async getClientQRCodeSVG({ clientId }) {
    const config = await this.getClientConfiguration({ clientId });
    return QRCode.toString(config, {
      type: 'svg',
      width: 512,
    });
  }

  async createClient({ name, expiredDate }) {
    const normalizedName = this.__normalizeClientName(name);
    const runtime = await this.__loadRuntimeSettings();

    const config = await this.getConfig();

    const privateKey = await Util.exec('wg genkey');
    const publicKey = await Util.exec(`echo ${privateKey} | wg pubkey`, {
      log: 'echo ***hidden*** | wg pubkey',
    });
    const preSharedKey = await Util.exec('wg genpsk');

    // Calculate next IP
    let address;
    for (let i = 2; i < 255; i++) {
      const client = Object.values(config.clients).find((client) => {
        return client.address === runtime.wgDefaultAddress.replace('x', i);
      });

      if (!client) {
        address = runtime.wgDefaultAddress.replace('x', i);
        break;
      }
    }

    if (!address) {
      throw new Error('Maximum number of clients reached.');
    }
    // Create Client
    const id = crypto.randomUUID();
    const client = {
      id,
      name: normalizedName,
      address,
      aclGroups: [],
      privateKey,
      publicKey,
      preSharedKey,

      createdAt: new Date(),
      updatedAt: new Date(),
      expiredAt: null,
      enabled: true,
    };
    if (expiredDate) {
      client.expiredAt = new Date(expiredDate);
      client.expiredAt.setHours(23);
      client.expiredAt.setMinutes(59);
      client.expiredAt.setSeconds(59);
    }
    config.clients[id] = client;

    await this.saveConfig();

    return client;
  }

  async deleteClient({ clientId }) {
    const config = await this.getConfig();

    if (config.clients[clientId]) {
      delete config.clients[clientId];
      await this.saveConfig();
    }
  }

  async enableClient({ clientId }) {
    const client = await this.getClient({ clientId });

    client.enabled = true;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async generateOneTimeLink({ clientId }) {
    const client = await this.getClient({ clientId });
    client.oneTimeLink = crypto.randomBytes(24).toString('base64url');
    client.oneTimeLinkExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    client.updatedAt = new Date();
    await this.saveConfig();
  }

  async eraseOneTimeLink({ clientId }) {
    const client = await this.getClient({ clientId });
    client.oneTimeLink = null;
    client.oneTimeLinkExpiresAt = null;
    client.updatedAt = new Date();
    await this.saveConfig();
  }

  async disableClient({ clientId }) {
    const client = await this.getClient({ clientId });

    client.enabled = false;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientName({ clientId, name }) {
    const client = await this.getClient({ clientId });

    client.name = this.__normalizeClientName(name);
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientAddress({ clientId, address }) {
    const client = await this.getClient({ clientId });

    if (!Util.isValidIPv4(address)) {
      throw new ServerError(`Invalid Address: ${address}`, 400);
    }

    client.address = address;
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientAclGroups({ clientId, aclGroups }) {
    const client = await this.getClient({ clientId });
    client.aclGroups = Array.isArray(aclGroups)
      ? aclGroups
      : typeof aclGroups === 'string'
        ? aclGroups.split(/[,\n;]+/)
        : [];
    this.__normalizeClientAclGroups(client);
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async updateClientExpireDate({ clientId, expireDate }) {
    const client = await this.getClient({ clientId });

    if (expireDate) {
      client.expiredAt = new Date(expireDate);
      client.expiredAt.setHours(23);
      client.expiredAt.setMinutes(59);
      client.expiredAt.setSeconds(59);
    } else {
      client.expiredAt = null;
    }
    client.updatedAt = new Date();

    await this.saveConfig();
  }

  async getClientIsolationSettings() {
    const config = await this.getConfig();
    const isolation = this.__pruneClientIsolationRules(config);
    const availableGroups = [...new Set(
      Object.values(config.clients)
        .flatMap((client) => Array.isArray(client.aclGroups) ? client.aclGroups : [])
        .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right));

    return {
      enabled: isolation.enabled,
      availableGroups,
      rules: isolation.rules.map((rule) => ({
        ...rule,
      })),
    };
  }

  async getUplinkSettings() {
    const config = await this.getConfig();
    const uplink = this.__getEffectiveUplinkSettings(config, this.__normalizeUplinkSettings(config));

    return {
      id: uplink.id,
      name: uplink.name,
      enabled: uplink.enabled,
      configPath: uplink.configPath,
      interfaceName: uplink.interfaceName,
      table: uplink.table,
      sourceRules: [...uplink.sourceRules],
      destinationDomains: [...uplink.destinationDomains],
    };
  }

  async getUplinkSettingsList() {
    const config = await this.getConfig();
    const uplinks = this.__normalizeUplinkSettingsList(config)
      .map((uplink) => this.__getEffectiveUplinkSettings(config, uplink));

    return uplinks.map((uplink) => ({
      id: uplink.id,
      name: uplink.name,
      enabled: uplink.enabled,
      configPath: uplink.configPath,
      interfaceName: uplink.interfaceName,
      table: uplink.table,
      sourceRules: [...uplink.sourceRules],
      destinationDomains: [...uplink.destinationDomains],
    }));
  }

  async getClientUplinkAssignment(clientId) {
    const config = await this.getConfig();
    this.__normalizeClientUplinkAssignments(config);

    return config.clientUplinkAssignments[clientId] === 'main'
      ? null
      : (config.clientUplinkAssignments[clientId] || null);
  }

  async setClientUplinkAssignment({
    clientId,
    uplinkId = null,
  }) {
    const config = await this.getConfig();
    if (!config.clients[clientId]) {
      throw new ServerError(`Client not found: ${clientId}`, 404);
    }

    this.__normalizeUplinkSettingsList(config);
    this.__normalizeClientUplinkAssignments(config);

    if (uplinkId === null || uplinkId === '' || uplinkId === 'main') {
      config.clientUplinkAssignments[clientId] = 'main';
    } else {
      const uplink = config.uplinks.find((candidate) => candidate.id === uplinkId);
      if (!uplink) {
        throw new ServerError(`Uplink not found: ${uplinkId}`, 404);
      }

      config.clientUplinkAssignments[clientId] = uplinkId;
    }

    await this.saveConfig();

    return {
      clientId,
      uplinkId: config.clientUplinkAssignments[clientId] === 'main'
        ? null
        : (config.clientUplinkAssignments[clientId] || null),
    };
  }

  async getRoutingCategories() {
    const config = await this.getConfig();
    const categories = this.__validateRoutingCategories(config);

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      enabled: category.enabled,
      uplinkId: category.uplinkId,
      domains: [...category.domains],
    }));
  }

  async updateRoutingCategories({ categories }) {
    const config = await this.getConfig();
    this.__normalizeUplinkSettingsList(config);

    const inputCategories = Array.isArray(categories) ? categories : [];
    config.routingCategories = inputCategories.map((category, index) => ({
      id: typeof category?.id === 'string' && category.id.trim() ? category.id.trim() : crypto.randomUUID(),
      name: typeof category?.name === 'string' && category.name.trim() ? category.name.trim() : `Category ${index + 1}`,
      enabled: category?.enabled !== false,
      uplinkId: typeof category?.uplinkId === 'string' && category.uplinkId.trim() ? category.uplinkId.trim() : null,
      domains: Array.isArray(category?.domains)
        ? category.domains
        : typeof category?.domains === 'string'
          ? category.domains.split(/[\n,;]+/)
          : [],
    }));

    this.__validateRoutingCategories(config);
    this.__normalizeClientRoutingCategoryAssignments(config);
    await this.saveConfig();
    return this.getRoutingCategories();
  }

  async getClientRoutingCategories(clientId) {
    const config = await this.getConfig();
    if (!config.clients[clientId]) {
      throw new ServerError(`Client not found: ${clientId}`, 404);
    }

    const categories = this.__validateRoutingCategories(config);
    const assignments = this.__normalizeClientRoutingCategoryAssignments(config);
    const enabledCategoryIds = new Set(assignments[clientId] || []);

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      enabled: category.enabled,
      uplinkId: category.uplinkId,
      domains: [...category.domains],
      active: enabledCategoryIds.has(category.id),
    }));
  }

  async toggleClientRoutingCategory({
    clientId,
    categoryId,
    enabled,
  }) {
    const config = await this.getConfig();
    if (!config.clients[clientId]) {
      throw new ServerError(`Client not found: ${clientId}`, 404);
    }

    const categories = this.__validateRoutingCategories(config);
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) {
      throw new ServerError(`Routing category not found: ${categoryId}`, 404);
    }

    this.__normalizeClientRoutingCategoryAssignments(config);
    const assigned = new Set(config.clientRoutingCategories[clientId] || []);
    if (enabled) {
      assigned.add(categoryId);
    } else {
      assigned.delete(categoryId);
    }

    if (assigned.size > 0) {
      config.clientRoutingCategories[clientId] = [...assigned];
    } else {
      delete config.clientRoutingCategories[clientId];
    }

    await this.saveConfig();
    return this.getClientRoutingCategories(clientId);
  }

  async getDnsRoutingSettings() {
    const config = await this.getConfig();
    const dnsRouting = this.__normalizeDnsRoutingSettings(config);

    return {
      enabled: dnsRouting.enabled,
      upstreams: [...dnsRouting.upstreams],
      listenAddress: config.server.address,
    };
  }

  async getDnsQueryLogs({
    limit = 200,
  } = {}) {
    const config = await this.getConfig();
    const dnsRouting = this.__normalizeDnsRoutingSettings(config);
    const { logPath } = this.__getDnsRoutingPaths();
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit, 10) || 200));

    const lines = await Util.exec(`tail -n ${safeLimit} ${this.__escapeShellArgument(logPath)}`, {
      log: false,
    }).then((stdout) => stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean))
      .catch(() => []);

    const stats = await fs.stat(logPath).catch(() => null);

    return {
      enabled: dnsRouting.enabled,
      logPath,
      lines,
      updatedAt: stats ? new Date(stats.mtimeMs).toISOString() : null,
    };
  }

  async testUplinkConnection({ uplinkId = null } = {}) {
    const config = await this.getConfig();
    const uplinkSettings = this.__validateUplinkSettingsList(this.__normalizeUplinkSettingsList(config));
    const selectedSettings = uplinkId
      ? uplinkSettings.find((candidate) => candidate.id === uplinkId)
      : uplinkSettings[0];

    if (!selectedSettings) {
      throw new ServerError(uplinkId ? 'Requested uplink was not found.' : 'Uplink is not configured.', 400);
    }

    const uplink = await this.__getValidatedUplinkConfig({
      ...config,
      uplink: { ...selectedSettings, enabled: true },
      uplinks: [{ ...selectedSettings, enabled: true }],
    });

    const runtimeUplinks = Array.isArray(this.__uplinkRuntime) ? this.__uplinkRuntime : [];
    const currentlyManaged = runtimeUplinks.some((candidate) => this.__isSameUplinkConfig(candidate, uplink));
    let startedForTest = false;

    try {
      if (!currentlyManaged) {
        await Util.exec(`wg-quick down ${uplink.interfaceName}`, {
          log: false,
        }).catch(() => {});
        await this.__bringUpUplinkInterface(uplink);
        startedForTest = true;
      }

      const sourceAddress = await this.__getInterfaceIpv4Address(uplink.interfaceName);
      if (!sourceAddress) {
        throw new ServerError(`Unable to determine IPv4 address of ${uplink.interfaceName}.`, 400);
      }

      const probe = await this.__runUplinkProbe(uplink.interfaceName, sourceAddress);
      const peerState = await this.__getUplinkPeerState(uplink.interfaceName);
      const freshHandshake = Boolean(
        peerState.latestHandshakeAt
        && (Date.now() - peerState.latestHandshakeAt.getTime() <= 30000)
      );

      if (!probe.connected && !freshHandshake) {
        throw new ServerError(`Uplink test failed: ${probe.error || 'No fresh handshake detected.'}`, 400);
      }

      return {
        success: true,
        interfaceName: uplink.interfaceName,
        sourceAddress,
        connected: probe.connected,
        latestHandshakeAt: peerState.latestHandshakeAt ? peerState.latestHandshakeAt.toISOString() : null,
        endpoint: peerState.endpoint || null,
        transferRx: peerState.transferRx,
        transferTx: peerState.transferTx,
        message: freshHandshake
          ? `Uplink test succeeded: fresh handshake detected on ${uplink.interfaceName}.`
          : `Uplink probe connected successfully through ${uplink.interfaceName}.`,
      };
    } finally {
      if (startedForTest) {
        await Util.exec(`wg-quick down ${uplink.interfaceName}`, {
          log: false,
        }).catch(() => {});
      }
    }
  }

  async updateClientIsolationSettings({
    enabled,
    rules,
  }) {
    const config = await this.getConfig();
    const isolation = this.__normalizeClientIsolation(config);

    isolation.enabled = enabled === true;
    isolation.rules = Array.isArray(rules)
      ? rules.map((rule) => this.__validateClientIsolationRule(rule, config.clients))
      : [];

    await this.saveConfig();

    return this.getClientIsolationSettings();
  }

  async getUplinkProtectedCidrs() {
    const config = await this.getConfig();

    return {
      cidrs: [...this.__normalizeUplinkProtectedCidrs(config)],
    };
  }

  async updateUplinkProtectedCidrs({
    cidrs,
  }) {
    const config = await this.getConfig();
    config.uplinkProtectedCidrs = Array.isArray(cidrs)
      ? cidrs
      : typeof cidrs === 'string'
        ? cidrs.split(/[\n,;]+/)
        : [];

    this.__normalizeUplinkProtectedCidrs(config);
    await this.saveConfig();
    return this.getUplinkProtectedCidrs();
  }

  async updateUplinkSettings({
    id,
    name,
    enabled,
    configPath,
    interfaceName,
    table,
    sourceRules,
    destinationDomains,
  }) {
    const config = await this.getConfig();
    const validatedSettings = this.__validateUplinkSettings({
      id,
      name,
      enabled,
      configPath,
      interfaceName,
      table,
      sourceRules: Array.isArray(sourceRules)
        ? sourceRules
        : typeof sourceRules === 'string'
          ? sourceRules.split(/[\n,;]+/)
          : [],
      destinationDomains: Array.isArray(destinationDomains)
        ? destinationDomains
        : typeof destinationDomains === 'string'
          ? destinationDomains.split(/[\n,;]+/)
          : [],
    });

    if (validatedSettings.enabled) {
      await this.__getValidatedUplinkConfig({
        ...config,
        uplink: validatedSettings,
        uplinks: [validatedSettings],
      });
    }

    config.uplinks = [validatedSettings];
    config.uplink = validatedSettings;
    await this.saveConfig();
    return this.getUplinkSettings();
  }

  async updateUplinkSettingsList({ uplinks }) {
    const config = await this.getConfig();
    const validatedUplinks = this.__validateUplinkSettingsList(Array.isArray(uplinks) ? uplinks : []);

    if (validatedUplinks.some((uplink) => uplink.enabled)) {
      await this.__getValidatedUplinkConfigs({
        ...config,
        uplinks: validatedUplinks,
        uplink: validatedUplinks[0] || this.__getDefaultUplinkSettings(),
      });
    }

    config.uplinks = validatedUplinks;
    config.uplink = validatedUplinks.length > 0
      ? { ...validatedUplinks[0] }
      : this.__getEmptyUplinkSettings();
    await this.saveConfig();
    return this.getUplinkSettingsList();
  }

  async updateDnsRoutingSettings({
    enabled,
    upstreams,
  }) {
    const config = await this.getConfig();
    config.dnsRouting = this.__validateDnsRoutingSettings({
      enabled,
      upstreams: Array.isArray(upstreams)
        ? upstreams
        : typeof upstreams === 'string'
          ? upstreams.split(/[\s,\n;]+/)
          : [],
    });

    await this.saveConfig();
    return this.getDnsRoutingSettings();
  }

  async __reloadConfig() {
    return this.__runLifecycleExclusive(async () => {
      const config = await this.__buildConfig();
      this.__configPromise = config;
      await this.__syncConfig();
      await this.__syncClientIsolationFirewall(config);
      await this.__syncUplinkRouting(config);
      return config;
    });
  }

  async restoreConfiguration(config) {
    debug('Starting configuration restore process.');
    return this.__runLifecycleExclusive(async () => {
      const _config = JSON.parse(config);
      this.__assertValidRestoreConfig(_config);
      await this.__saveConfig(_config);
      this.__configPromise = _config;
      await this.__reloadConfig();
      debug('Configuration restore process completed.');
    });
  }

  async backupConfiguration() {
    debug('Starting configuration backup.');
    const config = await this.getConfig();
    const backup = JSON.stringify(config, null, 2);
    debug('Configuration backup completed.');
    return backup;
  }

  // Shutdown wireguard
  async Shutdown() {
    return this.__runLifecycleExclusive(async () => {
      await this.__stopDnsRouting().catch((err) => {
        debug(`Failed to stop VPN DNS routing: ${err.message}`);
      });
      await this.__teardownUplinkRouting().catch((err) => {
        debug(`Failed to tear down uplink routing: ${err.message}`);
      });
      await Util.exec('wg-quick down wg0').catch(() => {});
    });
  }

  async cronJobEveryMinute() {
    const runtime = await this.__loadRuntimeSettings();
    const config = await this.getConfig();
    let needSaveConfig = false;

    await this.__refreshRuntimeUplinkDomains();

    // Expires Feature
    if (runtime.enableExpireTime) {
      for (const client of Object.values(config.clients)) {
        if (client.enabled !== true) continue;
        if (client.expiredAt !== null && new Date() > new Date(client.expiredAt)) {
          debug(`Client ${client.id} expired.`);
          needSaveConfig = true;
          client.enabled = false;
          client.updatedAt = new Date();
        }
      }
    }
    // One Time Link Feature
    if (runtime.enableOneTimeLinks) {
      for (const client of Object.values(config.clients)) {
        if (client.oneTimeLink !== null && new Date() > new Date(client.oneTimeLinkExpiresAt)) {
          debug(`Client ${client.id} One Time Link expired.`);
          needSaveConfig = true;
          client.oneTimeLink = null;
          client.oneTimeLinkExpiresAt = null;
          client.updatedAt = new Date();
        }
      }
    }
    if (needSaveConfig) {
      await this.saveConfig();
    }
  }

  async getMetrics() {
    const runtime = await this.__loadRuntimeSettings();
    const clients = await this.getClients();
    let wireguardPeerCount = 0;
    let wireguardEnabledPeersCount = 0;
    let wireguardConnectedPeersCount = 0;
    let wireguardSentBytes = '';
    let wireguardReceivedBytes = '';
    let wireguardLatestHandshakeSeconds = '';
    for (const client of Object.values(clients)) {
      wireguardPeerCount++;
      if (client.enabled === true) {
        wireguardEnabledPeersCount++;
      }
      if (client.endpoint !== null) {
        wireguardConnectedPeersCount++;
      }
      const escapedAddress = this.__escapePrometheusLabelValue(client.address);
      const escapedName = this.__escapePrometheusLabelValue(client.name);
      wireguardSentBytes += `wireguard_sent_bytes{interface="wg0",enabled="${client.enabled}",address="${escapedAddress}",name="${escapedName}"} ${Number(client.transferTx)}\n`;
      wireguardReceivedBytes += `wireguard_received_bytes{interface="wg0",enabled="${client.enabled}",address="${escapedAddress}",name="${escapedName}"} ${Number(client.transferRx)}\n`;
      wireguardLatestHandshakeSeconds += `wireguard_latest_handshake_seconds{interface="wg0",enabled="${client.enabled}",address="${escapedAddress}",name="${escapedName}"} ${client.latestHandshakeAt ? (new Date().getTime() - new Date(client.latestHandshakeAt).getTime()) / 1000 : 0}\n`;
    }

    let returnText = '# HELP wg-easy and wireguard metrics\n';

    returnText += '\n# HELP wireguard_configured_peers\n';
    returnText += '# TYPE wireguard_configured_peers gauge\n';
    returnText += `wireguard_configured_peers{interface="wg0"} ${Number(wireguardPeerCount)}\n`;

    returnText += '\n# HELP wireguard_enabled_peers\n';
    returnText += '# TYPE wireguard_enabled_peers gauge\n';
    returnText += `wireguard_enabled_peers{interface="wg0"} ${Number(wireguardEnabledPeersCount)}\n`;

    returnText += '\n# HELP wireguard_connected_peers\n';
    returnText += '# TYPE wireguard_connected_peers gauge\n';
    returnText += `wireguard_connected_peers{interface="wg0"} ${Number(wireguardConnectedPeersCount)}\n`;

    returnText += '\n# HELP wireguard_sent_bytes Bytes sent to the peer\n';
    returnText += '# TYPE wireguard_sent_bytes counter\n';
    returnText += `${wireguardSentBytes}`;

    returnText += '\n# HELP wireguard_received_bytes Bytes received from the peer\n';
    returnText += '# TYPE wireguard_received_bytes counter\n';
    returnText += `${wireguardReceivedBytes}`;

    returnText += '\n# HELP wireguard_latest_handshake_seconds UNIX timestamp seconds of the last handshake\n';
    returnText += '# TYPE wireguard_latest_handshake_seconds gauge\n';
    returnText += `${wireguardLatestHandshakeSeconds}`;

    return returnText;
  }

  async getMetricsJSON() {
    const clients = await this.getClients();
    let wireguardPeerCount = 0;
    let wireguardEnabledPeersCount = 0;
    let wireguardConnectedPeersCount = 0;
    const latestClients = this.__trafficHistory.getLatestClients();
    const latestByClientId = new Map(latestClients.map((client) => [client.clientId, client]));
    for (const client of Object.values(clients)) {
      wireguardPeerCount++;
      if (client.enabled === true) {
        wireguardEnabledPeersCount++;
      }
      if (client.endpoint !== null) {
        wireguardConnectedPeersCount++;
      }
    }
    return {
      wireguard_configured_peers: Number(wireguardPeerCount),
      wireguard_enabled_peers: Number(wireguardEnabledPeersCount),
      wireguard_connected_peers: Number(wireguardConnectedPeersCount),
      traffic_history_enabled: this.__trafficSamplerEnabled,
      traffic_sample_interval_seconds: runtime.trafficSampleIntervalSeconds,
      clients: clients.map((client) => {
        const latest = latestByClientId.get(client.id);
        return {
          id: client.id,
          name: client.name,
          address: client.address,
          enabled: client.enabled,
          connected: client.endpoint !== null,
          sent_bytes: Number(client.transferTx || 0),
          received_bytes: Number(client.transferRx || 0),
          latest_handshake_seconds: client.latestHandshakeAt
            ? (new Date().getTime() - new Date(client.latestHandshakeAt).getTime()) / 1000
            : 0,
          tx_bytes_per_second: latest ? latest.txRate : null,
          rx_bytes_per_second: latest ? latest.rxRate : null,
          sampled_at: latest ? new Date(latest.ts).toISOString() : null,
        };
      }),
    };
  }

  async getTrafficOverview() {
    const runtime = await this.__loadRuntimeSettings();
    return {
      enabled: this.__trafficSamplerEnabled,
      sampleIntervalSeconds: runtime.trafficSampleIntervalSeconds,
      rawRetentionHours: runtime.trafficRawRetentionHours,
      minuteRetentionDays: runtime.trafficMinuteRetentionDays,
      hourRetentionDays: runtime.trafficHourRetentionDays,
      clients: this.__trafficHistory.getLatestClients().map((client) => ({
        ...client,
        sampledAt: new Date(client.ts).toISOString(),
      })),
    };
  }

  async getClientTrafficHistory({
    clientId,
    period = 'day',
  }) {
    await this.getClient({ clientId });

    if (!this.__trafficSamplerEnabled) {
      throw new ServerError('Traffic history is disabled', 400);
    }

    if (!['day', 'week', 'month'].includes(period)) {
      throw new ServerError(`Unsupported traffic period: ${period}`, 400);
    }

    return this.__trafficHistory.getClientHistory({
      clientId,
      period,
    });
  }

};

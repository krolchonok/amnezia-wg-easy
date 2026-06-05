/* eslint-disable no-unused-vars */
/* global window, localStorage */

'use strict';

(() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('mock')) return;

  const now = Date.now();
  const hoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000);
  const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000);

  const state = {
    settings: {
      wgHost: 'demo.example.net',
      defaultDns: '10.8.0.1',
      runtime: {
        wgPort: '51820',
        wgConfigPort: '51820',
        wgMtu: '1420',
        wgDefaultAddress: '10.8.0.x',
        wgAllowedIps: '0.0.0.0/0, ::/0',
        wgPersistentKeepalive: '25',
        uiTrafficStats: true,
        uiChartType: 2,
        enableOneTimeLinks: true,
        enableSortClients: true,
        enableExpireTime: true,
        avatarDicebearType: '',
        avatarUseGravatar: false,
        trafficHistoryEnabled: true,
        trafficSampleIntervalSeconds: 5,
        trafficRawRetentionHours: 24,
        trafficMinuteRetentionDays: 90,
        trafficHourRetentionDays: 365,
      },
      hasPassword: true,
      telegram: {
        enabled: true,
        token: '123456:mock-token',
        adminIds: '100001,100002',
        pollTimeoutSeconds: 25,
        subscriptionPhoneNumber: '+79990000000',
        subscriptionRecipientName: 'Demo Admin',
        subscriptionBankName: 'T-Bank',
        subscriptionPaymentNote: 'VPN demo',
      },
    },
    clients: [
      {
        id: 'client-1',
        name: 'Alice phone',
        enabled: true,
        address: '10.8.0.2',
        publicKey: 'alicePublicKeyMock111111111111111111111111111=',
        createdAt: daysAgo(16),
        updatedAt: hoursAgo(2),
        expiredAt: null,
        latestHandshakeAt: new Date(now - 55 * 1000),
        transferRx: 4241000000,
        transferTx: 1844000000,
        downloadableConfig: true,
        oneTimeLink: 'alice-demo-link',
        aclGroups: ['family', 'mobile'],
      },
      {
        id: 'client-2',
        name: 'Office laptop',
        enabled: true,
        address: '10.8.0.3',
        publicKey: 'officePublicKeyMock222222222222222222222222222=',
        createdAt: daysAgo(7),
        updatedAt: hoursAgo(6),
        expiredAt: new Date(now + 31 * 24 * 60 * 60 * 1000),
        latestHandshakeAt: hoursAgo(3),
        transferRx: 822000000,
        transferTx: 302000000,
        downloadableConfig: true,
        oneTimeLink: '',
        aclGroups: ['work'],
      },
      {
        id: 'client-3',
        name: 'Guest tablet',
        enabled: false,
        address: '10.8.0.9',
        publicKey: 'guestPublicKeyMock333333333333333333333333333=',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
        expiredAt: new Date(now + 3 * 24 * 60 * 60 * 1000),
        latestHandshakeAt: null,
        transferRx: 0,
        transferTx: 0,
        downloadableConfig: true,
        oneTimeLink: '',
        aclGroups: ['guest'],
      },
    ],
    clientIsolation: {
      enabled: true,
      availableGroups: ['family', 'mobile', 'work', 'guest'],
      rules: [
        {
          id: 'acl-1',
          enabled: true,
          action: 'allow',
          sourceType: 'group',
          sourceValue: 'work',
          targetType: 'cidr',
          targetValue: '192.168.10.0/24',
          bidirectional: true,
        },
        {
          id: 'acl-2',
          enabled: true,
          action: 'deny',
          sourceType: 'group',
          sourceValue: 'guest',
          targetType: 'all',
          targetValue: '',
          bidirectional: false,
        },
      ],
    },
    uplinks: [
      {
        id: 'uplink-1',
        name: 'Germany AWG',
        enabled: true,
        configPath: '/etc/wireguard/uplinks/awg-de.conf',
        interfaceName: 'awg-de',
        table: 200,
        sourceRules: ['10.8.0.2/32'],
        destinationDomains: ['youtube.com', 'googlevideo.com'],
      },
      {
        id: 'uplink-2',
        name: 'Netherlands WG',
        enabled: false,
        configPath: '/etc/wireguard/uplinks/wg-nl.conf',
        interfaceName: 'wg-nl',
        table: 201,
        sourceRules: ['10.8.0.3/32'],
        destinationDomains: ['example.com'],
      },
    ],
    uplinkConfigs: [
      { name: 'awg-de.conf', path: '/etc/wireguard/uplinks/awg-de.conf', interfaceName: 'awg-de' },
      { name: 'wg-nl.conf', path: '/etc/wireguard/uplinks/wg-nl.conf', interfaceName: 'wg-nl' },
    ],
    protectedCidrs: ['172.24.0.0/16', '192.168.0.0/16', '10.0.0.0/8'],
    routingCategories: [
      {
        id: 'category-1',
        name: 'Video',
        enabled: true,
        uplinkId: 'uplink-1',
        domains: ['youtube.com', 'googlevideo.com', 'netflix.com'],
      },
      {
        id: 'category-2',
        name: 'Work',
        enabled: false,
        uplinkId: 'uplink-2',
        domains: ['github.com', 'npmjs.com'],
      },
    ],
    dnsRouting: {
      enabled: true,
      listenAddress: '10.8.0.1',
      upstreams: ['1.1.1.1', '8.8.8.8'],
    },
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const wait = (value) => new Promise((resolve) => {
    window.setTimeout(() => resolve(value), 90);
  });

  const mapClient = (client) => ({
    ...clone(client),
    createdAt: new Date(client.createdAt),
    updatedAt: new Date(client.updatedAt),
    expiredAt: client.expiredAt ? new Date(client.expiredAt) : null,
    latestHandshakeAt: client.latestHandshakeAt ? new Date(client.latestHandshakeAt) : null,
  });

  const makeClientConfig = (client) => [
    '[Interface]',
    'PrivateKey = mock-private-key',
    `Address = ${client.address}/32`,
    'DNS = 10.8.0.1',
    '',
    '[Peer]',
    `PublicKey = ${client.publicKey}`,
    'AllowedIPs = 0.0.0.0/0, ::/0',
    'Endpoint = demo.example.net:51820',
    'PersistentKeepalive = 25',
  ].join('\n');

  const makeTraffic = (clientId, period) => {
    const pointCountByPeriod = {
      day: 96,
      week: 168,
      month: 180,
    };
    const stepMsByPeriod = {
      day: 15 * 60 * 1000,
      week: 60 * 60 * 1000,
      month: 4 * 60 * 60 * 1000,
    };
    const pointCount = pointCountByPeriod[period] || 96;
    const stepMs = stepMsByPeriod[period] || stepMsByPeriod.day;
    const seed = clientId.charCodeAt(clientId.length - 1) || 1;
    const series = [];

    for (let index = pointCount - 1; index >= 0; index -= 1) {
      const wave = Math.sin((pointCount - index + seed) / 8);
      const rxRate = Math.max(0, Math.round((80000 + seed * 9000) * (1 + wave)));
      const txRate = Math.max(0, Math.round((36000 + seed * 5000) * (1 + Math.cos(index / 9))));
      series.push({
        ts: new Date(now - index * stepMs).toISOString(),
        rxRate,
        txRate,
        rxTotal: rxRate * 18,
        txTotal: txRate * 18,
      });
    }

    const live = series[series.length - 1];
    return {
      enabled: true,
      period,
      resolution: period === 'day' ? '15m' : '1h',
      range: {
        from: series[0].ts,
        to: live.ts,
      },
      live,
      totals: {
        rx: series.reduce((sum, point) => sum + point.rxTotal, 0),
        tx: series.reduce((sum, point) => sum + point.txTotal, 0),
      },
      peaks: {
        rxRate: Math.max(...series.map((point) => point.rxRate)),
        txRate: Math.max(...series.map((point) => point.txRate)),
      },
      series,
    };
  };

  class MockAPI {

    constructor() {
      this.mockMode = true;
    }

    async getSetupState() {
      return wait({
        needsSetup: false,
        configured: true,
        hasPassword: false,
        wgHostConfigured: true,
        defaults: clone(state.settings.runtime),
      });
    }

    async getSession() {
      return wait({
        authenticated: true,
        requiresPassword: false,
      });
    }

    async createSession() {
      return wait({
        authenticated: true,
      });
    }

    async deleteSession() {
      return wait(undefined);
    }

    async getRelease() {
      return wait(999);
    }

    async getLang() {
      return wait(localStorage.getItem('lang') || 'ru');
    }

    async getRememberMeEnabled() {
      return wait(false);
    }

    async getuiTrafficStats() {
      return wait(true);
    }

    async getChartType() {
      return wait(2);
    }

    async getWGEnableOneTimeLinks() {
      return wait(true);
    }

    async getWGEnableExpireTime() {
      return wait(true);
    }

    async getUiSortClients() {
      return wait(true);
    }

    async getAvatarSettings() {
      return wait({ dicebear: null, gravatar: false });
    }

    async getTrafficOverview() {
      return wait({ enabled: true });
    }

    async getSettings() {
      return wait(clone(state.settings));
    }

    async updateSettings({
      wgHost,
      defaultDns,
      runtime,
      newPassword,
      telegram,
    }) {
      state.settings = {
        ...state.settings,
        wgHost,
        defaultDns,
        runtime: clone(runtime),
        telegram: clone(telegram),
        hasPassword: state.settings.hasPassword || Boolean(newPassword),
      };
      return wait(clone(state.settings));
    }

    async getClients() {
      return wait(state.clients.map(mapClient));
    }

    async createClient({ name, expiredDate }) {
      const index = state.clients.length + 2;
      state.clients.push({
        id: `client-${Date.now()}`,
        name,
        enabled: true,
        address: `10.8.0.${index}`,
        publicKey: `mockPublicKey${Date.now()}=`,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiredAt: expiredDate ? new Date(expiredDate) : null,
        latestHandshakeAt: null,
        transferRx: 0,
        transferTx: 0,
        downloadableConfig: true,
        oneTimeLink: '',
        aclGroups: [],
      });
      return wait(undefined);
    }

    async deleteClient({ clientId }) {
      state.clients = state.clients.filter((client) => client.id !== clientId);
      return wait(undefined);
    }

    async enableClient({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.enabled = true;
      return wait(undefined);
    }

    async disableClient({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.enabled = false;
      return wait(undefined);
    }

    async updateClientName({ clientId, name }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.name = name;
      return wait(undefined);
    }

    async updateClientAddress({ clientId, address }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.address = address;
      return wait(undefined);
    }

    async updateClientAclGroups({ clientId, aclGroups }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.aclGroups = Array.isArray(aclGroups) ? aclGroups : [];
      state.clientIsolation.availableGroups = Array.from(new Set(state.clients.flatMap((item) => item.aclGroups || [])));
      return wait(undefined);
    }

    async updateClientExpireDate({ clientId, expireDate }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.expiredAt = expireDate ? new Date(expireDate) : null;
      return wait(undefined);
    }

    async showOneTimeLink({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId);
      if (client) client.oneTimeLink = `mock-${clientId}-${Date.now()}`;
      return wait(undefined);
    }

    async getClientConfiguration({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId);
      return wait(makeClientConfig(client || state.clients[0]));
    }

    getClientConfigurationDownloadUrl({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId) || state.clients[0];
      const content = makeClientConfig(client);
      return `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
    }

    getClientQrCodeUrl({ clientId }) {
      const client = state.clients.find((item) => item.id === clientId) || state.clients[0];
      const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280">',
        '<rect width="280" height="280" fill="white"/>',
        '<rect x="24" y="24" width="72" height="72" fill="#111827"/>',
        '<rect x="184" y="24" width="72" height="72" fill="#111827"/>',
        '<rect x="24" y="184" width="72" height="72" fill="#111827"/>',
        '<text x="140" y="145" text-anchor="middle" font-family="monospace" font-size="16" fill="#111827">MOCK QR</text>',
        `<text x="140" y="170" text-anchor="middle" font-family="monospace" font-size="12" fill="#4b5563">${client.address}</text>`,
        '</svg>',
      ].join('');
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    async getClientTraffic({ clientId, period }) {
      return wait(makeTraffic(clientId, period));
    }

    async getClientIsolation() {
      return wait(clone(state.clientIsolation));
    }

    async updateClientIsolation({ enabled, rules }) {
      state.clientIsolation.enabled = enabled === true;
      state.clientIsolation.rules = clone(rules);
      return wait(clone(state.clientIsolation));
    }

    async getUplinks() {
      return wait(clone(state.uplinks));
    }

    async updateUplinks({ uplinks }) {
      state.uplinks = clone(uplinks);
      return wait(clone(state.uplinks));
    }

    async getUplinkConfigs() {
      return wait(clone(state.uplinkConfigs));
    }

    async uploadUplinkConfig({ filename }) {
      const cleanName = String(filename || `mock-${Date.now()}.conf`).replace(/\.txt$/i, '.conf');
      const interfaceName = cleanName.replace(/\.[^.]+$/, '');
      const path = `/etc/wireguard/uplinks/${cleanName}`;
      state.uplinkConfigs.push({ name: cleanName, path, interfaceName });
      return wait({ name: cleanName, path, interfaceName });
    }

    async getUplinkProtectedCidrs() {
      return wait({ cidrs: clone(state.protectedCidrs) });
    }

    async updateUplinkProtectedCidrs({ cidrs }) {
      state.protectedCidrs = Array.isArray(cidrs) ? clone(cidrs) : [];
      return wait({ cidrs: clone(state.protectedCidrs) });
    }

    async testUplinkConnection() {
      return wait({ ok: true, message: 'Mock uplink test succeeded.' });
    }

    async getRoutingCategories() {
      return wait(clone(state.routingCategories));
    }

    async updateRoutingCategories({ categories }) {
      state.routingCategories = clone(categories);
      return wait(clone(state.routingCategories));
    }

    async getDnsRouting() {
      return wait(clone(state.dnsRouting));
    }

    async updateDnsRouting({ enabled, upstreams }) {
      state.dnsRouting.enabled = enabled === true;
      state.dnsRouting.upstreams = Array.isArray(upstreams) ? clone(upstreams) : [];
      return wait(clone(state.dnsRouting));
    }

    async getDnsLogs() {
      return wait({
        enabled: state.dnsRouting.enabled,
        logPath: '/var/log/dnsmasq.mock.log',
        updatedAt: new Date().toISOString(),
        lines: [
          'query[A] youtube.com from 10.8.0.2',
          'forwarded youtube.com to 1.1.1.1',
          'reply youtube.com is 142.250.185.206',
          'query[A] github.com from 10.8.0.3',
          'reply github.com is 140.82.121.4',
        ],
      });
    }

    async restoreConfiguration() {
      return wait({ ok: true });
    }

  }

  window.WgEasyApiClass = MockAPI;
  window.EventSource = function MockEventSource() {
    this.close = () => {};
  };
})();

/* eslint-disable no-console */
/* eslint-disable no-alert */
/* eslint-disable no-undef */
/* eslint-disable no-new */

'use strict';

function bytes(bytes, decimals, kib, maxunit) {
  kib = kib || false;
  if (bytes === 0) return '0 B';
  if (Number.isNaN(parseFloat(bytes)) && !Number.isFinite(bytes)) return 'NaN';
  const k = kib ? 1024 : 1000;
  const dm = decimals != null && !Number.isNaN(decimals) && decimals >= 0 ? decimals : 2;
  const sizes = kib
    ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB', 'BiB']
    : ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB', 'BB'];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  if (maxunit !== undefined) {
    const index = sizes.indexOf(maxunit);
    if (index !== -1) i = index;
  }
  // eslint-disable-next-line no-restricted-properties
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Sorts an array of objects by a specified property in ascending or descending order.
 *
 * @param {Array} array - The array of objects to be sorted.
 * @param {string} property - The property to sort the array by.
 * @param {boolean} [sort=true] - Whether to sort the array in ascending (default) or descending order.
 * @return {Array} - The sorted array of objects.
 */
function sortByProperty(array, property, sort = true) {
  if (sort) {
    return array.sort((a, b) => (typeof a[property] === 'string' ? a[property].localeCompare(b[property]) : a[property] - b[property]));
  }

  return array.sort((a, b) => (typeof a[property] === 'string' ? b[property].localeCompare(a[property]) : b[property] - a[property]));
}

const i18n = new VueI18n({
  locale: localStorage.getItem('lang') || 'en',
  fallbackLocale: 'en',
  messages,
});

const UI_CHART_TYPES = [
  { type: false, strokeWidth: 0 },
  { type: 'line', strokeWidth: 3 },
  { type: 'area', strokeWidth: 0 },
  { type: 'bar', strokeWidth: 0 },
];

const CHART_COLORS = {
  rx: { light: 'rgba(128,128,128,0.3)', dark: 'rgba(255,255,255,0.3)' },
  tx: { light: 'rgba(128,128,128,0.4)', dark: 'rgba(255,255,255,0.3)' },
  gradient: { light: ['rgba(0,0,0,1.0)', 'rgba(0,0,0,1.0)'], dark: ['rgba(128,128,128,0)', 'rgba(128,128,128,0)'] },
};

const TRAFFIC_PERIODS = ['day', 'week', 'month'];

const LANGUAGE_LABELS = {
  en: 'English',
  ua: 'Українська',
  ru: 'Русский',
  tr: 'Türkçe',
  no: 'Norsk',
  pl: 'Polski',
  fr: 'Français',
  de: 'Deutsch',
  ca: 'Català',
  es: 'Español',
  ko: '한국어',
  vi: 'Tiếng Việt',
  nl: 'Nederlands',
  is: 'Íslenska',
  pt: 'Português',
  zh: '简体中文',
  tw: '繁體中文',
  it: 'Italiano',
  th: 'ไทย',
  hi: 'हिन्दी',
};

new Vue({
  el: '#app',
  components: {
    apexchart: VueApexCharts,
  },
  i18n,
  data: {
    authenticated: null,
    authenticating: false,
    password: null,
    requiresPassword: null,
    remember: false,
    rememberMeEnabled: false,

    clients: null,
    clientsPersist: {},
    clientDelete: null,
    clientCreate: null,
    clientCreateName: '',
    clientExpiredDate: '',
    clientEditName: null,
    clientEditNameId: null,
    clientEditAddress: null,
    clientEditAddressId: null,
    clientEditExpireDate: null,
    clientEditExpireDateId: null,
    qrcode: null,
    configText: null,
    configClientName: null,
    trafficClient: null,
    trafficHistory: null,
    trafficHistoryPeriod: 'day',
    trafficHistoryLoading: false,
    trafficHistoryError: null,

    currentRelease: null,
    latestRelease: null,

    uiTrafficStats: false,

    uiChartType: 0,
    avatarSettings: {
      dicebear: null,
      gravatar: false,
    },
    enableOneTimeLinks: false,
    enableSortClient: false,
    sortClient: true, // Sort clients by name, true = asc, false = desc
    enableExpireTime: false,

    uiShowCharts: localStorage.getItem('uiShowCharts') === '1',
    uiTheme: localStorage.theme || 'auto',
    uiLanguage: localStorage.getItem('lang') || 'en',
    languageMenuOpen: false,
    languageMenuPosition: {
      top: 0,
      left: 0,
      width: 176,
    },
    prefersDarkScheme: window.matchMedia('(prefers-color-scheme: dark)'),

    chartOptions: {
      chart: {
        background: 'transparent',
        stacked: false,
        toolbar: {
          show: false,
        },
        animations: {
          enabled: false,
        },
        parentHeightOffset: 0,
        sparkline: {
          enabled: true,
        },
      },
      colors: [],
      stroke: {
        curve: 'smooth',
      },
      fill: {
        type: 'gradient',
        gradient: {
          shade: 'dark',
          type: 'vertical',
          shadeIntensity: 0,
          gradientToColors: CHART_COLORS.gradient[this.theme],
          inverseColors: false,
          opacityTo: 0,
          stops: [0, 100],
        },
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        bar: {
          horizontal: false,
        },
      },
      xaxis: {
        labels: {
          show: false,
        },
        axisTicks: {
          show: false,
        },
        axisBorder: {
          show: false,
        },
      },
      yaxis: {
        labels: {
          show: false,
        },
        min: 0,
      },
      tooltip: {
        enabled: false,
      },
      legend: {
        show: false,
      },
      grid: {
        show: false,
        padding: {
          left: -10,
          right: 0,
          bottom: -15,
          top: -15,
        },
        column: {
          opacity: 0,
        },
        xaxis: {
          lines: {
            show: false,
          },
        },
      },
    },

  },
  methods: {
    dateTime: (value) => {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      }).format(value);
    },
    async refresh({
      updateCharts = false,
    } = {}) {
      if (!this.authenticated) return;

      const clients = await this.api.getClients();
      this.clients = clients.map((client) => {
        if (client.name.includes('@') && client.name.includes('.') && this.avatarSettings.gravatar) {
          client.avatar = `https://gravatar.com/avatar/${sha256(client.name.toLowerCase().trim())}.jpg`;
        } else if (this.avatarSettings.dicebear) {
          client.avatar = `https://api.dicebear.com/9.x/${this.avatarSettings.dicebear}/svg?seed=${sha256(client.name.toLowerCase().trim())}`;
        }

        if (!this.clientsPersist[client.id]) {
          this.clientsPersist[client.id] = {};
          this.clientsPersist[client.id].transferRxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
          this.clientsPersist[client.id].transferTxHistory = Array(50).fill(0);
          this.clientsPersist[client.id].transferTxPrevious = client.transferTx;
        }

        // Debug
        // client.transferRx = this.clientsPersist[client.id].transferRxPrevious + Math.random() * 1000;
        // client.transferTx = this.clientsPersist[client.id].transferTxPrevious + Math.random() * 1000;
        // client.latestHandshakeAt = new Date();
        // this.requiresPassword = true;

        this.clientsPersist[client.id].transferRxCurrent = client.transferRx - this.clientsPersist[client.id].transferRxPrevious;
        this.clientsPersist[client.id].transferRxPrevious = client.transferRx;
        this.clientsPersist[client.id].transferTxCurrent = client.transferTx - this.clientsPersist[client.id].transferTxPrevious;
        this.clientsPersist[client.id].transferTxPrevious = client.transferTx;

        if (updateCharts) {
          this.clientsPersist[client.id].transferRxHistory.push(this.clientsPersist[client.id].transferRxCurrent);
          this.clientsPersist[client.id].transferRxHistory.shift();

          this.clientsPersist[client.id].transferTxHistory.push(this.clientsPersist[client.id].transferTxCurrent);
          this.clientsPersist[client.id].transferTxHistory.shift();

          this.clientsPersist[client.id].transferTxSeries = [{
            name: 'Tx',
            data: this.clientsPersist[client.id].transferTxHistory,
          }];

          this.clientsPersist[client.id].transferRxSeries = [{
            name: 'Rx',
            data: this.clientsPersist[client.id].transferRxHistory,
          }];

          client.transferTxHistory = this.clientsPersist[client.id].transferTxHistory;
          client.transferRxHistory = this.clientsPersist[client.id].transferRxHistory;
          client.transferMax = Math.max(...client.transferTxHistory, ...client.transferRxHistory);

          client.transferTxSeries = this.clientsPersist[client.id].transferTxSeries;
          client.transferRxSeries = this.clientsPersist[client.id].transferRxSeries;
        }

        client.transferTxCurrent = this.clientsPersist[client.id].transferTxCurrent;
        client.transferRxCurrent = this.clientsPersist[client.id].transferRxCurrent;

        client.hoverTx = this.clientsPersist[client.id].hoverTx;
        client.hoverRx = this.clientsPersist[client.id].hoverRx;

        return client;
      });

      if (this.enableSortClient) {
        this.clients = sortByProperty(this.clients, 'name', this.sortClient);
      }
    },
    login(e) {
      e.preventDefault();

      if (!this.password) return;
      if (this.authenticating) return;

      this.authenticating = true;
      this.api.createSession({
        password: this.password,
        remember: this.remember,
      })
        .then(async () => {
          const session = await this.api.getSession();
          this.authenticated = session.authenticated;
          this.requiresPassword = session.requiresPassword;
          return this.refresh();
        })
        .catch((err) => {
          alert(err.message || err.toString());
        })
        .finally(() => {
          this.authenticating = false;
          this.password = null;
        });
    },
    logout(e) {
      e.preventDefault();

      this.api.deleteSession()
        .then(() => {
          this.authenticated = false;
          this.clients = null;
        })
        .catch((err) => {
          alert(err.message || err.toString());
        });
    },
    createClient() {
      const name = this.clientCreateName;
      const expiredDate = this.clientExpiredDate;
      if (!name) return;

      this.api.createClient({ name, expiredDate })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    deleteClient(client) {
      this.api.deleteClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    showOneTimeLink(client) {
      this.api.showOneTimeLink({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    showClientConfiguration(client) {
      this.api.getClientConfiguration({ clientId: client.id })
        .then((configText) => {
          this.configClientName = client.name;
          this.configText = configText;
        })
        .catch((err) => alert(err.message || err.toString()));
    },
    closeClientConfiguration() {
      this.configText = null;
      this.configClientName = null;
    },
    escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    highlightConfigLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return '';

      if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
        return `<span class="text-neutral-500 italic">${this.escapeHtml(line)}</span>`;
      }

      if (/^\[[^\]]+\]$/.test(trimmed)) {
        return `<span class="text-blue-700 dark:text-blue-300 font-semibold">${this.escapeHtml(trimmed)}</span>`;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return this.escapeHtml(line);
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      const normalizedKey = key.toLowerCase();

      const keyClass = 'text-red-700 dark:text-red-300';
      const valueClassesByKey = {
        privatekey: 'text-emerald-700 dark:text-emerald-300',
        publickey: 'text-emerald-700 dark:text-emerald-300',
        presharedkey: 'text-emerald-700 dark:text-emerald-300',
        endpoint: 'text-sky-700 dark:text-sky-300',
        address: 'text-sky-700 dark:text-sky-300',
        allowedips: 'text-sky-700 dark:text-sky-300',
        dns: 'text-sky-700 dark:text-sky-300',
        listenport: 'text-amber-700 dark:text-amber-300',
        persistentkeepalive: 'text-amber-700 dark:text-amber-300',
        mtu: 'text-amber-700 dark:text-amber-300',
        jc: 'text-amber-700 dark:text-amber-300',
        jmin: 'text-amber-700 dark:text-amber-300',
        jmax: 'text-amber-700 dark:text-amber-300',
        s1: 'text-amber-700 dark:text-amber-300',
        s2: 'text-amber-700 dark:text-amber-300',
        h1: 'text-amber-700 dark:text-amber-300',
        h2: 'text-amber-700 dark:text-amber-300',
        h3: 'text-amber-700 dark:text-amber-300',
        h4: 'text-amber-700 dark:text-amber-300',
        postup: 'text-violet-700 dark:text-violet-300',
        preup: 'text-violet-700 dark:text-violet-300',
        postdown: 'text-violet-700 dark:text-violet-300',
        predown: 'text-violet-700 dark:text-violet-300',
      };
      const valueClass = valueClassesByKey[normalizedKey] || 'text-gray-900 dark:text-neutral-100';

      return `<span class="${keyClass}">${this.escapeHtml(key)}</span><span class="text-neutral-500"> = </span><span class="${valueClass}">${this.escapeHtml(value)}</span>`;
    },
    formatBytesValue(value, decimals = 2) {
      return bytes(Number(value || 0), decimals);
    },
    formatRateValue(value) {
      return `${this.formatBytesValue(value)}/s`;
    },
    formatTrafficPeriodLabel(period) {
      return this.$t(`traffic.period.${period}`);
    },
    downsampleTrafficSeries(series, maxPoints = 240) {
      if (!Array.isArray(series) || series.length <= maxPoints) {
        return series;
      }

      const bucketSize = Math.ceil(series.length / maxPoints);
      const reduced = [];

      for (let index = 0; index < series.length; index += bucketSize) {
        const bucket = series.slice(index, index + bucketSize);
        const last = bucket[bucket.length - 1];
        const avg = bucket.reduce((sum, point) => sum + point.y, 0) / bucket.length;
        reduced.push({
          x: last.x,
          y: avg,
        });
      }

      return reduced;
    },
    normalizeTrafficHistory(trafficHistory) {
      return {
        ...trafficHistory,
        live: trafficHistory.live
          ? {
            ...trafficHistory.live,
            sampledAt: new Date(trafficHistory.live.ts),
          }
          : null,
        series: Array.isArray(trafficHistory.series)
          ? trafficHistory.series.map((point) => ({
            ...point,
            sampledAt: new Date(point.ts),
          }))
          : [],
      };
    },
    openClientTraffic(client) {
      this.trafficClient = client;
      this.trafficHistory = null;
      this.trafficHistoryError = null;
      this.loadClientTraffic('day');
    },
    closeClientTraffic() {
      this.trafficClient = null;
      this.trafficHistory = null;
      this.trafficHistoryError = null;
      this.trafficHistoryLoading = false;
    },
    loadClientTraffic(period) {
      if (!this.trafficClient || this.trafficHistoryLoading || !TRAFFIC_PERIODS.includes(period)) return;

      this.trafficHistoryPeriod = period;
      this.trafficHistoryLoading = true;
      this.trafficHistoryError = null;

      this.api.getClientTraffic({ clientId: this.trafficClient.id, period })
        .then((trafficHistory) => {
          this.trafficHistory = this.normalizeTrafficHistory(trafficHistory);
        })
        .catch((err) => {
          this.trafficHistoryError = err.message || err.toString();
        })
        .finally(() => {
          this.trafficHistoryLoading = false;
        });
    },
    async copyClientConfiguration() {
      if (!this.configText) return;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(this.configText);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = this.configText;
          textArea.setAttribute('readonly', '');
          textArea.style.position = 'fixed';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const copied = document.execCommand('copy');
          document.body.removeChild(textArea);

          if (!copied) {
            throw new Error('Failed to copy configuration.');
          }
        }

        alert(this.$t('configCopied'));
      } catch (err) {
        alert(err.message || err.toString());
      }
    },
    enableClient(client) {
      this.api.enableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    disableClient(client) {
      this.api.disableClient({ clientId: client.id })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientName(client, name) {
      this.api.updateClientName({ clientId: client.id, name })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientAddress(client, address) {
      this.api.updateClientAddress({ clientId: client.id, address })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    updateClientExpireDate(client, expireDate) {
      this.api.updateClientExpireDate({ clientId: client.id, expireDate })
        .catch((err) => alert(err.message || err.toString()))
        .finally(() => this.refresh().catch(console.error));
    },
    restoreConfig(e) {
      e.preventDefault();
      const file = e.currentTarget.files.item(0);
      if (file) {
        file.text()
          .then((content) => {
            this.api.restoreConfiguration(content)
              .then((_result) => alert('The configuration was updated.'))
              .catch((err) => alert(err.message || err.toString()))
              .finally(() => this.refresh().catch(console.error));
          })
          .catch((err) => alert(err.message || err.toString()));
      } else {
        alert('Failed to load your file!');
      }
    },
    toggleTheme() {
      const themes = ['light', 'dark', 'auto'];
      const currentIndex = themes.indexOf(this.uiTheme);
      const newIndex = (currentIndex + 1) % themes.length;
      this.uiTheme = themes[newIndex];
      localStorage.theme = this.uiTheme;
      this.setTheme(this.uiTheme);
    },
    setTheme(theme) {
      const { classList } = document.documentElement;
      const shouldAddDarkClass = theme === 'dark' || (theme === 'auto' && this.prefersDarkScheme.matches);
      classList.toggle('dark', shouldAddDarkClass);
    },
    handlePrefersChange(e) {
      if (localStorage.theme === 'auto') {
        this.setTheme(e.matches ? 'dark' : 'light');
      }
    },
    toggleCharts() {
      localStorage.setItem('uiShowCharts', this.uiShowCharts ? 1 : 0);
    },
    toggleLanguageMenu() {
      if (!this.languageMenuOpen) {
        this.updateLanguageMenuPosition();
      }
      this.languageMenuOpen = !this.languageMenuOpen;
    },
    selectLanguage(lang) {
      this.setLanguage(lang);
      this.languageMenuOpen = false;
    },
    updateLanguageMenuPosition() {
      const buttonEl = this.$refs.languageMenuButton;
      if (!buttonEl) return;

      const rect = buttonEl.getBoundingClientRect();
      const menuWidth = 176;
      const viewportPadding = 8;
      let left = rect.right - menuWidth;

      if (left < viewportPadding) {
        left = viewportPadding;
      }

      const maxLeft = window.innerWidth - menuWidth - viewportPadding;
      if (left > maxLeft) {
        left = Math.max(viewportPadding, maxLeft);
      }

      this.languageMenuPosition = {
        top: rect.bottom + 4,
        left,
        width: menuWidth,
      };
    },
    setLanguage(lang) {
      if (!i18n.availableLocales.includes(lang)) return;
      this.uiLanguage = lang;
      i18n.locale = lang;
      localStorage.setItem('lang', lang);
    },
  },
  filters: {
    bytes,
    timeago: (value) => {
      return timeago.format(value, i18n.locale);
    },
    expiredDateFormat: (value) => {
      if (value === null) return i18n.t('Permanent');
      const dateTime = new Date(value);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      return dateTime.toLocaleDateString(i18n.locale, options);
    },
    expiredDateEditFormat: (value) => {
      if (value === null) return 'yyyy-MM-dd';
    },
  },
  mounted() {
    this.handleGlobalClick = (event) => {
      if (!this.languageMenuOpen) return;
      const menuEl = this.$refs.languageMenu;
      if (menuEl && !menuEl.contains(event.target)) {
        this.languageMenuOpen = false;
      }
    };
    this.handleViewportChange = () => {
      if (this.languageMenuOpen) {
        this.updateLanguageMenuPosition();
      }
    };
    document.addEventListener('click', this.handleGlobalClick);
    document.addEventListener('touchstart', this.handleGlobalClick);
    window.addEventListener('resize', this.handleViewportChange);
    window.addEventListener('scroll', this.handleViewportChange, true);

    this.prefersDarkScheme.addListener(this.handlePrefersChange);
    this.setTheme(this.uiTheme);

    this.api = new API();
    this.api.getSession()
      .then((session) => {
        this.authenticated = session.authenticated;
        this.requiresPassword = session.requiresPassword;
        this.refresh({
          updateCharts: this.updateCharts,
        }).catch((err) => {
          alert(err.message || err.toString());
        });
      })
      .catch((err) => {
        alert(err.message || err.toString());
      });

    this.api.getRememberMeEnabled()
      .then((rememberMeEnabled) => {
        this.rememberMeEnabled = rememberMeEnabled;
      });

    setInterval(() => {
      this.refresh({
        updateCharts: this.updateCharts,
      }).catch(console.error);
    }, 1000);

    this.api.getuiTrafficStats()
      .then((res) => {
        this.uiTrafficStats = res;
      })
      .catch(() => {
        this.uiTrafficStats = false;
      });

    this.api.getChartType()
      .then((res) => {
        this.uiChartType = parseInt(res, 10);
      })
      .catch(() => {
        this.uiChartType = 0;
      });

    this.api.getWGEnableOneTimeLinks()
      .then((res) => {
        this.enableOneTimeLinks = res;
      })
      .catch(() => {
        this.enableOneTimeLinks = false;
      });

    this.api.getUiSortClients()
      .then((res) => {
        this.enableSortClient = res;
      })
      .catch(() => {
        this.enableSortClient = false;
      });

    this.api.getWGEnableExpireTime()
      .then((res) => {
        this.enableExpireTime = res;
      })
      .catch(() => {
        this.enableExpireTime = false;
      });

    this.api.getAvatarSettings()
      .then((res) => {
        this.avatarSettings = res;
      })
      .catch(() => {
        this.avatarSettings = {
          dicebear: null,
          gravatar: false,
        };
      });

    Promise.resolve().then(async () => {
      const savedLang = localStorage.getItem('lang');
      if (savedLang && i18n.availableLocales.includes(savedLang)) {
        this.setLanguage(savedLang);
      } else {
        const lang = await this.api.getLang();
        if (i18n.availableLocales.includes(lang)) {
          this.setLanguage(lang);
        } else {
          this.setLanguage('en');
        }
      }

      const currentRelease = await this.api.getRelease();
      const latestRelease = await fetch('https://wg-easy.github.io/wg-easy/changelog.json')
        .then((res) => res.json())
        .then((releases) => {
          const releasesArray = Object.entries(releases).map(([version, changelog]) => ({
            version: parseInt(version, 10),
            changelog,
          }));
          releasesArray.sort((a, b) => {
            return b.version - a.version;
          });

          return releasesArray[0];
        });

      if (currentRelease >= latestRelease.version) return;

      this.currentRelease = currentRelease;
      this.latestRelease = latestRelease;
    }).catch((err) => console.error(err));
  },
  beforeDestroy() {
    if (this.handleGlobalClick) {
      document.removeEventListener('click', this.handleGlobalClick);
      document.removeEventListener('touchstart', this.handleGlobalClick);
    }
    if (this.handleViewportChange) {
      window.removeEventListener('resize', this.handleViewportChange);
      window.removeEventListener('scroll', this.handleViewportChange, true);
    }
  },
  computed: {
    chartOptionsTX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.tx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    chartOptionsRX() {
      const opts = {
        ...this.chartOptions,
        colors: [CHART_COLORS.rx[this.theme]],
      };
      opts.chart.type = UI_CHART_TYPES[this.uiChartType].type || false;
      opts.stroke.width = UI_CHART_TYPES[this.uiChartType].strokeWidth;
      return opts;
    },
    updateCharts() {
      return this.uiChartType > 0 && this.uiShowCharts;
    },
    highlightedConfigText() {
      if (typeof this.configText !== 'string') {
        return '';
      }

      return this.configText
        .split('\n')
        .map((line) => this.highlightConfigLine(line))
        .join('\n');
    },
    trafficHistorySummaryCards() {
      if (!this.trafficHistory || !this.trafficHistory.summary) {
        return [];
      }

      const { summary, live } = this.trafficHistory;

      return [
        {
          label: this.$t('traffic.cards.downloaded'),
          value: this.formatBytesValue(summary.rxBytes),
          tone: 'blue',
        },
        {
          label: this.$t('traffic.cards.uploaded'),
          value: this.formatBytesValue(summary.txBytes),
          tone: 'red',
        },
        {
          label: this.$t('traffic.cards.maxDownloadRate'),
          value: this.formatRateValue(summary.maxRxRate),
          tone: 'sky',
        },
        {
          label: this.$t('traffic.cards.maxUploadRate'),
          value: this.formatRateValue(summary.maxTxRate),
          tone: 'rose',
        },
        {
          label: this.$t('traffic.cards.currentDownloadRate'),
          value: live ? this.formatRateValue(live.rxRate) : '0 B/s',
          tone: 'indigo',
        },
        {
          label: this.$t('traffic.cards.currentUploadRate'),
          value: live ? this.formatRateValue(live.txRate) : '0 B/s',
          tone: 'orange',
        },
      ];
    },
    trafficResolutionLabel() {
      if (!this.trafficHistory) {
        return '';
      }

      return this.$t(`traffic.resolution.${this.trafficHistory.resolution}`);
    },
    trafficSummaryHint() {
      if (!this.trafficHistory || !this.trafficHistory.summary) {
        return '';
      }

      return `${this.$t('traffic.samples')}: ${this.trafficHistory.summary.sampleCount}`;
    },
    trafficChartOptions() {
      const isDark = this.theme === 'dark';

      return {
        chart: {
          type: 'area',
          background: 'transparent',
          toolbar: {
            show: false,
          },
          zoom: {
            enabled: false,
          },
          animations: {
            enabled: false,
          },
          foreColor: isDark ? '#d4d4d8' : '#4b5563',
        },
        stroke: {
          curve: 'smooth',
          width: 2.5,
        },
        fill: {
          type: 'gradient',
          gradient: {
            shade: isDark ? 'dark' : 'light',
            shadeIntensity: 0.15,
            opacityFrom: isDark ? 0.34 : 0.28,
            opacityTo: 0.04,
            stops: [0, 100],
          },
        },
        dataLabels: {
          enabled: false,
        },
        markers: {
          size: 0,
          hover: {
            sizeOffset: 3,
          },
        },
        xaxis: {
          type: 'datetime',
          labels: {
            datetimeUTC: false,
            style: {
              colors: isDark ? '#a1a1aa' : '#6b7280',
            },
          },
          axisBorder: {
            show: false,
          },
          axisTicks: {
            show: false,
          },
        },
        yaxis: {
          labels: {
            formatter: (value) => this.formatBytesValue(value),
            style: {
              colors: isDark ? '#a1a1aa' : '#6b7280',
            },
          },
        },
        tooltip: {
          theme: isDark ? 'dark' : 'light',
          style: {
            fontSize: '12px',
          },
          x: {
            formatter: (_value, context) => {
              return this.dateTime(new Date(context.w.globals.seriesX[0][context.dataPointIndex]));
            },
          },
          y: {
            formatter: (value) => this.formatRateValue(value),
          },
        },
        grid: {
          borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)',
          strokeDashArray: 5,
        },
        legend: {
          show: false,
        },
      };
    },
    trafficRxChartOptions() {
      return {
        ...this.trafficChartOptions,
        colors: ['#2563eb'],
      };
    },
    trafficTxChartOptions() {
      return {
        ...this.trafficChartOptions,
        colors: ['#dc2626'],
      };
    },
    trafficRxChartSeries() {
      if (!this.trafficHistory) return [];

      const points = this.trafficHistory.series.map((point) => ({
        x: point.sampledAt.getTime(),
        y: point.rxRateAvg || point.rxRate || 0,
      }));

      return [{
        name: 'RX',
        data: this.downsampleTrafficSeries(points),
      }];
    },
    trafficTxChartSeries() {
      if (!this.trafficHistory) return [];

      const points = this.trafficHistory.series.map((point) => ({
        x: point.sampledAt.getTime(),
        y: point.txRateAvg || point.txRate || 0,
      }));

      return [{
        name: 'TX',
        data: this.downsampleTrafficSeries(points),
      }];
    },
    trafficRangeLabel() {
      if (!this.trafficHistory) {
        return '';
      }

      return `${this.dateTime(new Date(this.trafficHistory.sinceAt))} - ${this.dateTime(new Date(this.trafficHistory.untilAt))}`;
    },
    trafficLiveStats() {
      if (!this.trafficHistory || !this.trafficHistory.live) {
        return [];
      }

      const { live } = this.trafficHistory;

      return [
        {
          label: this.$t('traffic.currentDownloadRate'),
          value: this.formatRateValue(live.rxRate),
          tone: 'blue',
        },
        {
          label: this.$t('traffic.currentUploadRate'),
          value: this.formatRateValue(live.txRate),
          tone: 'red',
        },
        {
          label: this.$t('traffic.totalDownloaded'),
          value: this.formatBytesValue(live.rxTotal),
          tone: 'sky',
        },
        {
          label: this.$t('traffic.totalUploaded'),
          value: this.formatBytesValue(live.txTotal),
          tone: 'rose',
        },
      ];
    },
    languageOptions() {
      return i18n.availableLocales.map((code) => ({
        code,
        label: LANGUAGE_LABELS[code] || code.toUpperCase(),
      }));
    },
    currentLanguageLabel() {
      const selected = this.languageOptions.find((lang) => lang.code === this.uiLanguage);
      return selected ? selected.label : this.uiLanguage.toUpperCase();
    },
    languageMenuStyle() {
      return {
        position: 'fixed',
        top: `${this.languageMenuPosition.top}px`,
        left: `${this.languageMenuPosition.left}px`,
        width: `${this.languageMenuPosition.width}px`,
        zIndex: 1000,
      };
    },
    theme() {
      if (this.uiTheme === 'auto') {
        return this.prefersDarkScheme.matches ? 'dark' : 'light';
      }
      return this.uiTheme;
    },
  },
});

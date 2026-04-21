'use strict';

const { release: { version } } = require('./package.json');

module.exports.RELEASE = version;
module.exports.PORT = process.env.PORT || '51821';
module.exports.WEBUI_HOST = process.env.WEBUI_HOST || '0.0.0.0';
module.exports.PASSWORD_HASH = process.env.PASSWORD_HASH;
module.exports.PASSWORD = process.env.PASSWORD;
module.exports.MAX_AGE = parseInt(process.env.MAX_AGE, 10) * 1000 * 60 || 0;
module.exports.WG_PATH = process.env.WG_PATH || '/etc/wireguard/';
module.exports.WG_DEVICE = process.env.WG_DEVICE || 'eth0';
module.exports.WG_HOST = process.env.WG_HOST;
module.exports.WG_PORT = process.env.WG_PORT || '51820';
module.exports.WG_CONFIG_PORT = process.env.WG_CONFIG_PORT || process.env.WG_PORT || '51820';
module.exports.WG_MTU = process.env.WG_MTU || null;
module.exports.WG_PERSISTENT_KEEPALIVE = process.env.WG_PERSISTENT_KEEPALIVE || '0';
module.exports.WG_DEFAULT_ADDRESS = process.env.WG_DEFAULT_ADDRESS || '10.8.0.x';
module.exports.WG_DEFAULT_DNS = typeof process.env.WG_DEFAULT_DNS === 'string'
  ? process.env.WG_DEFAULT_DNS
  : '1.1.1.1';
module.exports.WG_DNS_ROUTING_ENABLED = process.env.WG_DNS_ROUTING_ENABLED || 'false';
module.exports.WG_DNS_ROUTING_UPSTREAMS = process.env.WG_DNS_ROUTING_UPSTREAMS || module.exports.WG_DEFAULT_DNS;
module.exports.WG_ALLOWED_IPS = process.env.WG_ALLOWED_IPS || '0.0.0.0/0, ::/0';
module.exports.WG_UPLINK_ENABLED = process.env.WG_UPLINK_ENABLED || 'false';
module.exports.WG_UPLINK_INTERFACE = process.env.WG_UPLINK_INTERFACE || '';
module.exports.WG_UPLINK_CONFIG_PATH = process.env.WG_UPLINK_CONFIG_PATH || '';
module.exports.WG_UPLINK_CONFIGS_PATH = process.env.WG_UPLINK_CONFIGS_PATH || '/etc/wireguard/uplinks';
module.exports.WG_UPLINK_TABLE = Math.max(1, parseInt(process.env.WG_UPLINK_TABLE, 10) || 200);
module.exports.WG_UPLINK_SOURCE_RULES = process.env.WG_UPLINK_SOURCE_RULES || '';

module.exports.WG_PRE_UP = process.env.WG_PRE_UP || '';
module.exports.WG_POST_UP = process.env.WG_POST_UP || `
iptables -t nat -A POSTROUTING -s ${module.exports.WG_DEFAULT_ADDRESS.replace('x', '0')}/24 -o ${module.exports.WG_DEVICE} -j MASQUERADE;
iptables -A INPUT -p udp -m udp --dport ${module.exports.WG_PORT} -j ACCEPT;
iptables -A FORWARD -i wg0 -j ACCEPT;
iptables -A FORWARD -o wg0 -j ACCEPT;
`.split('\n').join(' ');

module.exports.WG_PRE_DOWN = process.env.WG_PRE_DOWN || '';
module.exports.WG_POST_DOWN = process.env.WG_POST_DOWN || `
iptables -t nat -D POSTROUTING -s ${module.exports.WG_DEFAULT_ADDRESS.replace('x', '0')}/24 -o ${module.exports.WG_DEVICE} -j MASQUERADE;
iptables -D INPUT -p udp -m udp --dport ${module.exports.WG_PORT} -j ACCEPT;
iptables -D FORWARD -i wg0 -j ACCEPT;
iptables -D FORWARD -o wg0 -j ACCEPT;
`.split('\n').join(' ');
module.exports.LANG = process.env.LANG || 'en';
module.exports.UI_TRAFFIC_STATS = process.env.UI_TRAFFIC_STATS || 'false';
module.exports.UI_CHART_TYPE = process.env.UI_CHART_TYPE || 0;
module.exports.WG_ENABLE_ONE_TIME_LINKS = process.env.WG_ENABLE_ONE_TIME_LINKS || 'false';
module.exports.UI_ENABLE_SORT_CLIENTS = process.env.UI_ENABLE_SORT_CLIENTS || 'false';
module.exports.WG_ENABLE_EXPIRES_TIME = process.env.WG_ENABLE_EXPIRES_TIME || 'false';
module.exports.TELEGRAM_BOT_ENABLED = process.env.TELEGRAM_BOT_ENABLED || 'false';
module.exports.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
module.exports.TELEGRAM_ADMIN_IDS = process.env.TELEGRAM_ADMIN_IDS || '';
module.exports.TELEGRAM_BOT_POLL_TIMEOUT_SECONDS = Math.max(1, parseInt(process.env.TELEGRAM_BOT_POLL_TIMEOUT_SECONDS, 10) || 25);
module.exports.ENABLE_PROMETHEUS_METRICS = process.env.ENABLE_PROMETHEUS_METRICS || 'false';
module.exports.PROMETHEUS_METRICS_PASSWORD = process.env.PROMETHEUS_METRICS_PASSWORD
  || process.env.PROMETHEUS_METRICS_PASSWORD_PLAIN;
module.exports.PROMETHEUS_METRICS_PASSWORD_HASH = process.env.PROMETHEUS_METRICS_PASSWORD_HASH
  || process.env.PROMETHEUS_METRICS_PASSWORD_BCRYPT;
module.exports.TRAFFIC_HISTORY_ENABLED = process.env.TRAFFIC_HISTORY_ENABLED || 'false';
module.exports.TRAFFIC_SAMPLE_INTERVAL_SECONDS = Math.max(1, parseInt(process.env.TRAFFIC_SAMPLE_INTERVAL_SECONDS, 10) || 1);
module.exports.TRAFFIC_RAW_RETENTION_HOURS = Math.max(1, parseInt(process.env.TRAFFIC_RAW_RETENTION_HOURS, 10) || 24);
module.exports.TRAFFIC_MINUTE_RETENTION_DAYS = Math.max(1, parseInt(process.env.TRAFFIC_MINUTE_RETENTION_DAYS, 10) || 90);
module.exports.TRAFFIC_HOUR_RETENTION_DAYS = Math.max(1, parseInt(process.env.TRAFFIC_HOUR_RETENTION_DAYS, 10) || 365);

if (module.exports.PASSWORD_HASH && module.exports.PASSWORD) {
  // eslint-disable-next-line no-console
  console.warn('Both PASSWORD_HASH and PASSWORD are set; either value can be used for login.');
}

if (process.env.PROMETHEUS_METRICS_PASSWORD_PLAIN) {
  // eslint-disable-next-line no-console
  console.warn('PROMETHEUS_METRICS_PASSWORD_PLAIN is deprecated, use PROMETHEUS_METRICS_PASSWORD.');
}

if (process.env.PROMETHEUS_METRICS_PASSWORD_BCRYPT) {
  // eslint-disable-next-line no-console
  console.warn('PROMETHEUS_METRICS_PASSWORD_BCRYPT is deprecated, use PROMETHEUS_METRICS_PASSWORD_HASH.');
}

if (module.exports.PROMETHEUS_METRICS_PASSWORD && module.exports.PROMETHEUS_METRICS_PASSWORD_HASH) {
  // eslint-disable-next-line no-console
  console.warn('Both PROMETHEUS_METRICS_PASSWORD and PROMETHEUS_METRICS_PASSWORD_HASH are set; either value can be used for metrics auth.');
}

module.exports.DICEBEAR_TYPE = process.env.DICEBEAR_TYPE || false;
module.exports.USE_GRAVATAR = process.env.USE_GRAVATAR || false;

module.exports.SSL_ENABLED = process.env.SSL_ENABLED === 'true';

const defaultSslCertPath = '/etc/ssl/certs/ssl-cert.pem';
const defaultSslKeyPath = '/etc/ssl/private/ssl-key.pem';
const rawSslCertPath = process.env.SSL_CERT_PATH;
const rawSslKeyPath = process.env.SSL_KEY_PATH;

if (typeof rawSslCertPath === 'string' && rawSslCertPath !== rawSslCertPath.trim()) {
  // eslint-disable-next-line no-console
  console.warn('SSL_CERT_PATH has leading/trailing spaces; using trimmed value.');
}

if (typeof rawSslKeyPath === 'string' && rawSslKeyPath !== rawSslKeyPath.trim()) {
  // eslint-disable-next-line no-console
  console.warn('SSL_KEY_PATH has leading/trailing spaces; using trimmed value.');
}

module.exports.SSL_CERT_PATH = (rawSslCertPath || defaultSslCertPath).trim();
module.exports.SSL_KEY_PATH = (rawSslKeyPath || defaultSslKeyPath).trim();

const getRandomInt = (min, max) => min + Math.floor(Math.random() * (max - min));
const getRandomJunkSize = () => getRandomInt(15, 150);
const getRandomHeader = () => getRandomInt(1, 2_147_483_647);

module.exports.JC = process.env.JC || getRandomInt(3, 10);
module.exports.JMIN = process.env.JMIN || 50;
module.exports.JMAX = process.env.JMAX || 1000;
module.exports.S1 = process.env.S1 || getRandomJunkSize();
module.exports.S2 = process.env.S2 || getRandomJunkSize();
module.exports.H1 = process.env.H1 || getRandomHeader();
module.exports.H2 = process.env.H2 || getRandomHeader();
module.exports.H3 = process.env.H3 || getRandomHeader();
module.exports.H4 = process.env.H4 || getRandomHeader();

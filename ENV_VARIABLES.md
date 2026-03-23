# ENV Variables

Полный список переменных окружения для `amnezia-wg-easy`.

## Core

| Variable | Default | Example | Description |
|---|---|---|---|
| `WG_HOST` | - | `vpn.example.com` | Публичный IP/домен сервера. Поддерживается `auto` (детект IP через `2ip.ru`, fallback `ifconfig.me`). |
| `PORT` | `51821` | `443` | TCP-порт Web UI/HTTPS. |
| `WEBUI_HOST` | `0.0.0.0` | `127.0.0.1` | Адрес bind для web-сервера. |
| `LANG` | `en` | `ru` | Язык Web UI. |

## Web UI auth

| Variable | Default | Example | Description |
|---|---|---|---|
| `PASSWORD` | - | `myStrongPassword` | Пароль админки в открытом виде. |
| `PASSWORD_HASH` | - | `$2y$05$...` | Bcrypt-хеш пароля админки. |

Notes:

- Можно задать и `PASSWORD`, и `PASSWORD_HASH`; авторизация примет любой из них.

## WireGuard

| Variable | Default | Example | Description |
|---|---|---|---|
| `WG_DEVICE` | `eth0` | `ens6f0` | Интерфейс для NAT/маршрутизации. |
| `WG_PORT` | `51820` | `12345` | UDP-порт WireGuard. |
| `WG_CONFIG_PORT` | `WG_PORT` | `12345` | Порт, который попадает в клиентские конфиги (`Endpoint`). |
| `WG_MTU` | `null` | `1420` | MTU клиентов. |
| `WG_PERSISTENT_KEEPALIVE` | `0` | `25` | PersistentKeepalive в секундах. |
| `WG_DEFAULT_ADDRESS` | `10.8.0.x` | `10.6.0.x` | Подсеть клиентов. |
| `WG_DEFAULT_DNS` | `1.1.1.1` | `8.8.8.8, 8.8.4.4` | DNS для клиентов. |
| `WG_ALLOWED_IPS` | `0.0.0.0/0, ::/0` | `192.168.15.0/24` | AllowedIPs клиентов. |
| `WG_PRE_UP` | `''` | `...` | Команда перед запуском WG. |
| `WG_POST_UP` | built-in iptables | `...` | Команда после запуска WG. |
| `WG_PRE_DOWN` | `''` | `...` | Команда перед остановкой WG. |
| `WG_POST_DOWN` | built-in iptables | `...` | Команда после остановки WG. |

## UI features

| Variable | Default | Example | Description |
|---|---|---|---|
| `UI_TRAFFIC_STATS` | `false` | `true` | Расширенная статистика RX/TX в UI. |
| `UI_CHART_TYPE` | `0` | `1` | Тип графиков в UI (`0/1/2/3`). |
| `UI_ENABLE_SORT_CLIENTS` | `false` | `true` | Сортировка клиентов в UI. |
| `WG_ENABLE_ONE_TIME_LINKS` | `false` | `true` | One-time ссылки на конфиг. |
| `WG_ENABLE_EXPIRES_TIME` | `false` | `true` | Истечение срока действия клиентов. |
| `MAX_AGE` | `0` | `1440` | Время жизни сессии (минуты). |
| `DICEBEAR_TYPE` | `false` | `bottts` | Тип аватаров DiceBear. |
| `USE_GRAVATAR` | `false` | `true` | Использовать Gravatar. |

## HTTPS

| Variable | Default | Example | Description |
|---|---|---|---|
| `SSL_ENABLED` | `false` | `true` | Включить HTTPS. |
| `SSL_CERT_PATH` | `/etc/ssl/certs/ssl-cert.pem` | `/etc/letsencrypt/live/example.com/fullchain.pem` | Путь к сертификату. |
| `SSL_KEY_PATH` | `/etc/ssl/private/ssl-key.pem` | `/etc/letsencrypt/live/example.com/privkey.pem` | Путь к приватному ключу. |

## Prometheus metrics auth

| Variable | Default | Example | Description |
|---|---|---|---|
| `ENABLE_PROMETHEUS_METRICS` | `false` | `true` | Включить `/metrics` и `/metrics/json`. |
| `PROMETHEUS_METRICS_PASSWORD` | - | `metricsPass123` | Пароль Basic Auth для `/metrics*` (plain text). |
| `PROMETHEUS_METRICS_PASSWORD_HASH` | - | `$2y$05$...` | Bcrypt-хеш пароля Basic Auth для `/metrics*`. |

Notes:

- Можно задать и `PROMETHEUS_METRICS_PASSWORD`, и `PROMETHEUS_METRICS_PASSWORD_HASH`; авторизация примет любой.

### Deprecated aliases (backward compatibility)

| Variable | Replaced by |
|---|---|
| `PROMETHEUS_METRICS_PASSWORD_PLAIN` | `PROMETHEUS_METRICS_PASSWORD` |
| `PROMETHEUS_METRICS_PASSWORD_BCRYPT` | `PROMETHEUS_METRICS_PASSWORD_HASH` |

## Local traffic history

| Variable | Default | Example | Description |
|---|---|---|---|
| `TRAFFIC_HISTORY_ENABLED` | `false` | `true` | Включить локальное хранение трафика и скоростей. |
| `TRAFFIC_SAMPLE_INTERVAL_SECONDS` | `1` | `1` | Интервал сэмплирования. |
| `TRAFFIC_RAW_RETENTION_HOURS` | `24` | `24` | Сколько хранить сырые 1-секундные данные. |
| `TRAFFIC_MINUTE_RETENTION_DAYS` | `90` | `30` | Сколько хранить минутные агрегаты. |
| `TRAFFIC_HOUR_RETENTION_DAYS` | `365` | `180` | Сколько хранить часовые агрегаты. |

Notes:

- Данные сохраняются в `${WG_PATH}/traffic-history`.
- Для периода `day` используются raw 1s samples, для `week` минутные агрегаты, для `month` часовые агрегаты.
- API:
  - `GET /api/wireguard/traffic`
  - `GET /api/wireguard/client/:clientId/traffic?period=day|week|month`
- `/metrics/json` дополнительно возвращает список `clients` с текущими `rx_bytes_per_second` / `tx_bytes_per_second`, если sampler успел собрать данные.

## AmneziaWG obfuscation

| Variable | Default | Example | Description |
|---|---|---|---|
| `JC` | random | `5` | Количество junk-пакетов. |
| `JMIN` | `50` | `25` | Минимальный размер junk-пакета. |
| `JMAX` | `1000` | `250` | Максимальный размер junk-пакета. |
| `S1` | random | `75` | Размер junk-данных в init packet. |
| `S2` | random | `75` | Размер junk-данных в response packet. |
| `H1` | random | `1234567891` | Magic header init packet. |
| `H2` | random | `1234567892` | Magic header response packet. |
| `H3` | random | `1234567893` | Magic header underload packet. |
| `H4` | random | `1234567894` | Magic header transport packet. |

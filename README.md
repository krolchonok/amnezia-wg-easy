# AmneziaWG Easy

[![Build & Publish Image](https://github.com/krolchonok/amnezia-wg-easy/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/krolchonok/amnezia-wg-easy/actions/workflows/deploy.yml?query=branch%3Amain)

Упрощенный сервер WireGuard/AmneziaWG с Web UI, HTTPS и метриками.

<p align="center">
  <img src="./assets/screenshot.png" width="802" />
</p>

## Что умеет

- Управление клиентами WireGuard через Web UI.
- QR-коды и конфиги клиентов.
- One-time ссылки на конфиги.
- Истечение срока действия клиентов.
- UI-статистика трафика.
- Метрики для Prometheus/Zabbix.
- HTTPS с пользовательскими сертификатами.
- Поддержка AmneziaWG obfuscation-параметров (`JC`, `JMIN`, `JMAX`, `S1`, `S2`, `H1-H4`).

## Требования

- Linux сервер
- Docker + Docker Compose
- `/dev/net/tun`
- `NET_ADMIN`, `SYS_MODULE`

## Быстрый старт (локальный код)

```bash
cp .env_example .env
# при необходимости поправьте только bootstrap-параметры контейнера
docker compose -f docker-compose.local.yml up -d --build
docker logs -f amnezia-wg-easy-local
```

Дальше откройте Web UI и завершите initial setup:

- задайте пароль администратора
- задайте `WG_HOST`
- задайте клиентский DNS и остальные runtime-настройки WireGuard/UI/Telegram

Остановка:

```bash
docker compose -f docker-compose.local.yml down
```

Если видите предупреждение про orphan container, можно очистить:

```bash
docker compose -f docker-compose.local.yml up -d --remove-orphans
```

## Быстрый старт (готовый образ)

Опубликованный образ:

- GitHub Packages: `https://github.com/users/krolchonok/packages/container/package/amnezia-wg-easy`
- Registry: `ghcr.io/krolchonok/amnezia-wg-easy`

Загрузка образа:

```bash
docker pull ghcr.io/krolchonok/amnezia-wg-easy
```

Запуск через `docker run`:

```bash
docker run -d \
  --name=amnezia-wg-easy \
  --env-file .env \
  -v ~/.amnezia-wg-easy:/etc/wireguard \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -p 51820:51820/udp \
  -p 51821:51821/tcp \
  --cap-add=NET_ADMIN \
  --cap-add=SYS_MODULE \
  --sysctl="net.ipv4.conf.all.src_valid_mark=1" \
  --sysctl="net.ipv4.ip_forward=1" \
  --device=/dev/net/tun:/dev/net/tun \
  --restart unless-stopped \
  ghcr.io/krolchonok/amnezia-wg-easy
```

Запуск через `docker compose`:

```yaml
services:
  amnezia-wg-easy:
    image: ghcr.io/krolchonok/amnezia-wg-easy
    container_name: amnezia-wg-easy
    env_file:
      - .env
    volumes:
      - ./data:/etc/wireguard
      - /etc/letsencrypt:/etc/letsencrypt:ro
    ports:
      - "51820:51820/udp"
      - "51821:51821/tcp"
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.ip_forward=1
      - net.ipv4.conf.all.src_valid_mark=1
    devices:
      - /dev/net/tun:/dev/net/tun
```

Если используете compose из этого репозитория, достаточно:

```bash
cp .env_example .env
docker compose up -d
```

После первого запуска основная конфигурация задаётся через web setup/settings, а не через `.env`.

Обновить существующую установку можно так:

```bash
./update_container.sh
```

Если у вас полный git-репозиторий, скрипт сделает `git pull`, затем `docker compose pull` и `docker compose up -d --remove-orphans`.
Если установка сделана из deploy-архива без `.git`, скрипт скачает последний bundle из GitHub Release, обновит `docker-compose.yml`, `.env_example`, документацию, сохранит резервную копию текущего `.env` и перезапустит контейнер.

## Конфигурация `.env`

- Шаблон: [.env_example](/root/amnezia-wg-easy/.env_example)
- Полный список переменных: [ENV_VARIABLES.md](/root/amnezia-wg-easy/ENV_VARIABLES.md)

Минимум для запуска:

```env
WG_HOST=your.public.ip.or.domain
```

Рекомендуется сразу добавить пароль админки:

```env
PASSWORD=your_strong_password
# или
# PASSWORD_HASH=$2a$12$...
```

Короткая расшифровка основных переменных:

- `WG_HOST` — публичный IP или домен сервера, который попадёт в клиентские конфиги.
- `PORT` — TCP-порт Web UI и HTTPS/HTTP, по умолчанию `51821`.
- `WG_PORT` — UDP-порт WireGuard, по умолчанию `51820`.
- `WG_CONFIG_PORT` — порт в `Endpoint` клиентского конфига, если снаружи используется порт, отличный от внутреннего `WG_PORT`.
- `PASSWORD` — пароль админки в открытом виде.
- `PASSWORD_HASH` — bcrypt-хэш пароля админки; для `.env` используйте обычный вид с одиночными `$`.
- `LANG` — язык интерфейса, например `ru` или `en`.
- `WG_DEFAULT_DNS` — DNS, который будет прописан клиентам.
- `WG_ALLOWED_IPS` — сети, которые пойдут через VPN; по умолчанию весь трафик: `0.0.0.0/0, ::/0`.
- `WG_DNS_ROUTING_ENABLED` / `WG_DNS_ROUTING_UPSTREAMS` — включает встроенный VPN DNS (`dnsmasq`) и принудительный redirect обычного DNS-трафика клиентов.
- `WG_UPLINK_ENABLED` / `WG_UPLINK_*` — policy routing части клиентов через второй туннель в том же контейнере.
- `TELEGRAM_BOT_ENABLED` / `TELEGRAM_BOT_*` — Telegram bot для approval-flow и выдачи клиентских конфигов.
- `WG_ENABLE_ONE_TIME_LINKS` — включает одноразовые ссылки на скачивание `.conf`.
- `WG_ENABLE_EXPIRES_TIME` — включает дату истечения клиентов.
- `UI_TRAFFIC_STATS` — показывает расширенную статистику RX/TX в UI.
- `UI_CHART_TYPE` — тип мини-графиков трафика: `0=off`, `1=line`, `2=area`, `3=bar`.
- `UI_ENABLE_SORT_CLIENTS` — включает сортировку клиентов в интерфейсе.
- `MAX_AGE` — время жизни сессии в минутах, `0` означает до закрытия браузера.
- `SSL_ENABLED` — включает HTTPS.
- `SSL_CERT_PATH` / `SSL_KEY_PATH` — пути к сертификату и ключу внутри контейнера.
- `ENABLE_PROMETHEUS_METRICS` — включает `/metrics` и `/metrics/json`.
- `PROMETHEUS_METRICS_PASSWORD` / `PROMETHEUS_METRICS_PASSWORD_HASH` — защита метрик по Basic Auth.
- `TRAFFIC_HISTORY_ENABLED` — включает локальное хранение трафика и скоростей.
- `TRAFFIC_SAMPLE_INTERVAL_SECONDS` — интервал сэмплирования, по умолчанию `1`.
- `TRAFFIC_RAW_RETENTION_HOURS` — сколько хранить сырые 1-секундные samples, по умолчанию `24`.
- `TRAFFIC_MINUTE_RETENTION_DAYS` / `TRAFFIC_HOUR_RETENTION_DAYS` — сколько хранить минутные и часовые агрегаты.

## Policy Routing Через Второй Туннель

Можно увести часть клиентов `wg0` во второй WireGuard/AmneziaWG туннель внутри того же контейнера по source IP.
Через UI теперь также поддерживаются:

- несколько uplink-туннелей одновременно;
- приоритет туннелей сверху вниз;
- маршрутизация по destination domains через DNS -> `ipset` -> `fwmark`.

Пример:

```env
WG_UPLINK_ENABLED=true
WG_UPLINK_CONFIG_PATH=/etc/wireguard/awg1.conf
WG_UPLINK_INTERFACE=awg1
WG_UPLINK_TABLE=200
WG_UPLINK_SOURCE_RULES=10.8.0.4/32,10.8.0.10/32
```

Что делает этот режим:

- поднимает второй туннель через `wg-quick up`;
- создаёт отдельную таблицу маршрутизации;
- копирует в неё non-default IPv4 маршруты из `main`, чтобы не потерять доступ к локальным сетям;
- добавляет `ip rule from ... lookup ...` для указанных клиентов;
- может добавлять `ipset` + `mangle MARK` + `ip rule fwmark ...` для destination domains;
- включает `MASQUERADE` на uplink-интерфейс.

Важно:

- `WG_UPLINK_INTERFACE` должен совпадать с именем файла конфига, например `awg1` для `/etc/wireguard/awg1.conf`;
- в uplink-конфиге обязательно укажите `Table = off`;
- `WG_UPLINK_SOURCE_RULES` принимает IPv4/CIDR клиентских адресов, не только адреса из `WG_DEFAULT_ADDRESS/24`;
- routing по доменам настраивается через UI uplink-страницы, а не через `.env`;
- доменные правила сейчас работают по IPv4 A-records и периодически обновляются через DNS;
- wildcard-домены пока не поддерживаются.

## Telegram Bot

Бот работает через long polling и хранит своё состояние в SQLite вместе с остальными настройками.

Минимальные переменные:

```env
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:AA...
TELEGRAM_ADMIN_IDS=123456789
```

Что умеет текущий MVP:

- новый пользователь пишет боту и попадает в pending queue;
- админ получает заявку и может:
  - создать новый VPN-профиль одной кнопкой;
  - отклонить заявку;
  - привязать пользователя к существующему клиенту командой `/tg_link <requestId> <clientId|clientName>`;
- пользователь после approve может получить свои конфиги через `/myconfigs`;
- для отдельных пользователей админ может включить несколько устройств через `/tg_allow_devices <telegramUserId> on`, после чего пользователю доступна `/newdevice <name>`.

Сейчас бот не управляет ACL/uplink/domain rules напрямую. Это следующий слой поверх approval и config delivery.

## WG_HOST=auto

Поддерживается значение:

```env
WG_HOST=auto
```

При старте сервис попытается определить внешний IP через:

1. `https://2ip.ru`
2. `https://ifconfig.me/ip` (fallback)
3. `https://api.ipify.org`
4. `https://ipv4.icanhazip.com`
5. `https://checkip.amazonaws.com`
6. `https://ipinfo.io/ip`
7. `https://v4.ident.me`
8. `https://ipv4.seeip.org`
9. `https://myexternalip.com/raw`

Если все источники недоступны, контейнер завершится с ошибкой.

## HTTPS

Включение:

```env
SSL_ENABLED=true
SSL_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
```

Важно:

- Сертификаты создаются вручную пользователем (например, через Let's Encrypt/reverse proxy или иным способом).
- Если сертификаты не найдены или невалидны, сервис запустится по HTTP.
- При одном открытом порте редирект `http -> https` сделать нельзя (нужен второй HTTP-порт или reverse proxy).

## Генерация паролей (`wgpw`)

Готовый образ из GitHub Container Registry:

```bash
docker pull ghcr.io/krolchonok/amnezia-wg-easy
docker run --rm ghcr.io/krolchonok/amnezia-wg-easy wgpw 'YOUR_PASSWORD'
```

Интерактивно:

```bash
docker run --rm -it ghcr.io/krolchonok/amnezia-wg-easy wgpw
```

Локальный образ:

```bash
docker build -t amnezia-wg-easy:local .
docker run --rm amnezia-wg-easy:local wgpw 'YOUR_PASSWORD'
```

Интерактивно:

```bash
docker run --rm -it amnezia-wg-easy:local wgpw
```

Формат вывода:

```text
ORIGINAL_PASSWORD='...'

# Use this in .env
PASSWORD_HASH=...

# Use this directly in docker-compose.yml environment:
PASSWORD_HASH=$$2a$$...
```

## Мониторинг

### Prometheus

```env
ENABLE_PROMETHEUS_METRICS=true
PROMETHEUS_METRICS_PASSWORD=metrics_plain_password
# или
# PROMETHEUS_METRICS_PASSWORD_HASH=$$2a$$12$$...
```

Эндпоинты:

- `/metrics`
- `/metrics/json`

Проверка:

```bash
curl -k -u anyuser:YOUR_PASSWORD https://<HOST>:<PORT>/metrics
```

### Zabbix

Можно опрашивать `HTTP agent`:

- `https://<HOST>:<PORT>/metrics`
- `https://<HOST>:<PORT>/metrics/json`

Для быстрого старта проще использовать `/metrics/json` + JSONPath preprocessing.

## Локальная история трафика

Можно включить локальное хранение трафика и скоростей без внешней БД:

```env
TRAFFIC_HISTORY_ENABLED=true
TRAFFIC_SAMPLE_INTERVAL_SECONDS=1
TRAFFIC_RAW_RETENTION_HOURS=24
TRAFFIC_MINUTE_RETENTION_DAYS=90
TRAFFIC_HOUR_RETENTION_DAYS=365
```

Как это работает:

- raw 1-second samples хранятся 24 часа
- минутные агрегаты используются для недели
- часовые агрегаты используются для месяца и долгой истории
- файлы лежат в `${WG_PATH}/traffic-history`

API:

- `GET /api/wireguard/traffic` — live snapshot по клиентам
- `GET /api/wireguard/client/:clientId/traffic?period=day`
- `GET /api/wireguard/client/:clientId/traffic?period=week`
- `GET /api/wireguard/client/:clientId/traffic?period=month`

`/metrics/json` также возвращает список `clients` с:

- `sent_bytes`
- `received_bytes`
- `rx_bytes_per_second`
- `tx_bytes_per_second`
- `latest_handshake_seconds`

## Отладка

Смотрите логи контейнера:

```bash
docker logs -f amnezia-wg-easy-local
```

В логах есть расширенные SSL-сообщения:

- использованные `cert_path`/`key_path`
- найден ли файл
- старт HTTPS или fallback на HTTP

## Обновление

```bash
docker stop amnezia-wg-easy
docker rm amnezia-wg-easy
docker pull ghcr.io/krolchonok/amnezia-wg-easy
docker compose up -d
```

## Благодарности

- Основано на [wg-easy](https://github.com/wg-easy/wg-easy)
- Интеграция AmneziaWG: [amnezia-wg-easy](https://github.com/spcfox/amnezia-wg-easy)

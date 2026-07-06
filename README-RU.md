# vot-helper

Автономная CLI-утилита Windows x64 для аудиоперевода VOT и экспорта таймированных субтитров.

Проект собирает неофициальный helper-EXE вокруг закреплённого npm-пакета `@vot.js/node` `2.4.12`. Пользователю опубликованного `vot-helper.exe` не нужны Node.js или Bun.

## Загрузка и проверка

Релизные EXE не подписаны. Windows SmartScreen может показать предупреждение при первом запуске.

Перед использованием проверяйте скачанные файлы по `SHA256SUMS.txt` и provenance/attestation в GitHub.

## Команды

```powershell
vot-helper.exe translate --url https://youtu.be/example
vot-helper.exe translate --url https://youtu.be/example --output audio.mp3 --force
vot-helper.exe subtitles --url https://youtu.be/example
vot-helper.exe subtitles --url https://youtu.be/example --output subtitles.srt
vot-helper.exe subtitles --url https://youtu.be/example --original --source-lang en --format vtt --output original.vtt
```

У EXE две операционные команды:

- `translate` запрашивает у VOT аудиодорожку перевода. По умолчанию — на русский. Если перевод уже есть в upstream cache, команда может завершиться быстро. Если нет — helper будет polling-ом ждать готовности до timeout.
- `subtitles` запрашивает у VOT metadata дорожек субтитров. Без `--output` команда выводит список доступных дорожек. С `--output` выбирает дорожку, скачивает VOT subtitle JSON, нормализует cues и пишет SRT/VTT/JSON.

Значения по умолчанию:

- язык источника: `auto`
- целевой язык: `ru`
- timeout перевода: `900` секунд
- формат субтитров: `srt`

Операционные команды пишут один JSON-результат в stdout. Help и version печатают обычный текст. Диагностика и ошибки пишутся в stderr.

## Справочник флагов

Глобальные формы:

```powershell
vot-helper.exe --help
vot-helper.exe --version
vot-helper.exe translate --help
vot-helper.exe subtitles --help
```

Флаги `translate`:

| Флаг | Значение | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `--url` | HTTP(S) URL | обязателен | URL видео, который поддерживается upstream VOT helpers. |
| `--source-lang` | код языка | `auto` | Язык источника для VOT. Используйте явный `en`, если auto-выбор неоднозначен. |
| `--target-lang` | код языка | `ru` | Целевой язык перевода. |
| `--timeout` | положительное число секунд | `900` | Максимальное время ожидания, если перевод ещё не готов. |
| `--no-wait` | нет | `false` | Вернуть pending после первого ответа VOT, без polling. |
| `--lively-voice` | нет | `false` | Запросить lively voice. Требует `VOT_API_TOKEN` или `VOT_YANDEX_COOKIE`. |
| `--output` | путь | нет | Скачать аудио перевода в файл. Без флага JSON содержит временный audio URL. |
| `--force` | нет | `false` | Атомарно перезаписать существующий output-файл. |
| `--quiet` | нет | `false` | Зарезервировано для подавления не-error progress logs. |

Флаги `subtitles`:

| Флаг | Значение | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `--url` | HTTP(S) URL | обязателен | URL видео, который поддерживается upstream VOT helpers. |
| `--source-lang` | код языка | `auto` | Исходный язык субтитров. Указывайте явно, если VOT отдаёт несколько source-дорожек для одного target. |
| `--target-lang` | код языка | `ru` | Целевой язык переведённых субтитров. |
| `--format` | `srt`, `vtt`, `json` | `srt` | Формат выходных субтитров. |
| `--original` | нет | `false` | Выбрать оригинальные субтитры вместо переведённых. |
| `--output` | путь | нет | Записать выбранные субтитры. Без флага команда выводит metadata доступных дорожек. |
| `--force` | нет | `false` | Атомарно перезаписать существующий output-файл. |
| `--quiet` | нет | `false` | Зарезервировано для подавления не-error progress logs. |

## JSON contract для интеграций

Операционные команды всегда пишут ровно один JSON object и newline в stdout. Stderr предназначен для human-readable диагностики и не должен парситься как данные.

Успешный envelope:

```json
{
  "schemaVersion": 1,
  "ok": true,
  "operation": "translate",
  "helperVersion": "2.4.12-R2",
  "votVersion": "2.4.12",
  "data": {}
}
```

Error envelope:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "operation": "subtitles",
  "helperVersion": "2.4.12-R2",
  "votVersion": "2.4.12",
  "error": {
    "code": "subtitles",
    "message": "Subtitle track selection is ambiguous.",
    "details": {}
  }
}
```

Типичный `translate` success без `--output`:

```json
{
  "state": "ready",
  "translationId": "355844302",
  "audioUrl": "https://...",
  "status": 1
}
```

Типичный `translate` success с `--output` добавляет:

```json
{
  "output": {
    "path": "C:\\absolute\\audio.mp3",
    "bytes": 12963466,
    "contentType": "audio/mpeg"
  }
}
```

Типичный pending response с `--no-wait`:

```json
{
  "state": "pending",
  "translationId": "tr-pending",
  "remainingTimeSeconds": 30,
  "status": 2
}
```

Типичный `subtitles` listing:

```json
{
  "waiting": false,
  "tracks": [
    { "language": "en", "translatedLanguage": "ru" }
  ]
}
```

Типичный `subtitles` export:

```json
{
  "waiting": false,
  "selectedTrack": {
    "kind": "translated",
    "language": "ru",
    "translatedFromLanguage": "en",
    "url": "https://..."
  },
  "output": {
    "path": "C:\\absolute\\subtitles.srt",
    "bytes": 31093
  }
}
```

Для приватности и стабильности metadata ошибок выбора намеренно не содержит raw signed subtitle/audio URL.

## Pattern интеграции как subprocess

Рекомендуемый flow для другого приложения:

1. Поставить или скачать `vot-helper.exe`.
2. Запустить его как child process.
3. Передавать secrets только через environment variables.
4. Для операционных команд парсить stdout как один JSON line.
5. Любой non-zero exit code считать ошибкой и смотреть `error.code`.
6. Stderr использовать только для логов человеку.

Пример псевдокода:

```ts
const child = spawn("vot-helper.exe", [
  "translate",
  "--url", videoUrl,
  "--target-lang", "ru",
  "--output", outputPath,
  "--force",
], {
  env: {
    ...process.env,
    VOT_WORKER_HOST: "",
    VOT_API_TOKEN: token,
  },
});

const result = JSON.parse(await readAll(child.stdout));
if (!result.ok) throw new Error(result.error.message);
```

Запись файлов атомарная: helper пишет в соседний временный файл и переименовывает его в целевой путь только после успешной записи. Существующие output-файлы не перезаписываются без `--force`.

## Environment

Helper читает эти необязательные переменные окружения:

- `VOT_WORKER_HOST` — использовать VOT worker host вместо прямого клиента.
- `VOT_API_TOKEN` — API token для VOT-запросов.
- `VOT_YANDEX_COOKIE` — Yandex cookie, например `Session_id`; отправляется только в headers конкретных запросов.

`.env` игнорируется git и автоматически не загружается.

В GitHub Actions live smoke test также читает repository variables/secrets с теми же именами. Без этих credentials ошибка прямого VOT-перевода с GitHub-hosted runner помечается как пропущенная внешняя live-проверка, а не как падение обычного CI. Чтобы сделать live-проверку жёстким gate, задайте repository variable `VOT_LIVE_SMOKE_REQUIRED=true` вместе с одним из VOT credentials.

## Exit codes

- `2` неверные аргументы
- `3` ошибка получения video data
- `4` ошибка перевода
- `5` timeout перевода
- `6` ошибка субтитров
- `7` ошибка скачивания
- `8` ошибка файлового ввода-вывода
- `9` ошибка конфигурации
- `10` неожиданная ошибка

## Субтитры и ffmpeg

VOT subtitle JSON нормализуется в cues `{ text, startMs, durationMs }` и экспортируется как SRT, VTT или JSON. SRT/VTT timestamps строятся по этим таймингам, поэтому их можно вшивать или прожигать в видео через ffmpeg.

Soft-mux субтитров:

```powershell
ffmpeg -i input.mp4 -i subtitles.srt -c copy -c:s mov_text output.mp4
```

Прожиг субтитров в видео:

```powershell
ffmpeg -i input.mp4 -vf "subtitles=subtitles.srt" -c:a copy output-burned.mp4
```

## Поддерживаемые сайты

Helper делегирует поддержку сайтов upstream VOT-пакетам. Это best-effort поведение и оно может меняться при обновлении `@vot.js/node`.

## Upstream

Этот репозиторий не хранит исходный код VOT. Он закрепляет `@vot.js/node` как dependency и собирает EXE в GitHub Actions.

Upstream-проекты:

- `FOSWLY/vot.js`
- `ilyhalight/voice-over-translation`
- Bun

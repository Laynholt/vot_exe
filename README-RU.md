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

Значения по умолчанию:

- язык источника: `auto`
- целевой язык: `ru`
- timeout перевода: `900` секунд
- формат субтитров: `srt`

Операционные команды пишут один JSON-результат в stdout. Help и version печатают обычный текст. Диагностика и ошибки пишутся в stderr.

## Environment

Helper читает эти необязательные переменные окружения:

- `VOT_WORKER_HOST` — использовать VOT worker host вместо прямого клиента.
- `VOT_API_TOKEN` — API token для VOT-запросов.
- `VOT_YANDEX_COOKIE` — Yandex cookie, например `Session_id`; отправляется только в headers конкретных запросов.

`.env` игнорируется git и автоматически не загружается.

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

# Connector fixtures

## Synology DSM

Test fixtures for the Synology DSM connector (`../synology.rs`), see §8 and §12 of
[the Studio upkeep design](../../../../docs/superpowers/specs/2026-10-28-studio-upkeep-design.md).

**Documented shape, not captured from a real device.** Every `synology_*.json` file here was written
from Synology's DSM Web API documentation (DSM Login Web API guide: `SYNO.API.Info`, `SYNO.API.Auth`
login and its error codes) and from the publicly known response shapes of `SYNO.Core.System` `info`
and `SYNO.Storage.CGI.Storage` `load_info`. Serials, session ids and tokens are placeholders
(`SCRUBBED…`). The disk states (bad-sector threshold, SMART warning, crashed drive) are made up to
cover the health mapping.

Before relying on them, capture real responses from a NAS (scrub serials, `sid`, `synotoken` and the
device token) and replace or add to these files.

| File | Request |
| --- | --- |
| `synology_api_info.json` | `query.cgi` `SYNO.API.Info` `query` |
| `synology_login.json` | `SYNO.API.Auth` `login`, no 2-step verification |
| `synology_login_otp_required.json` | `login` without a code on a 2-step account (error 403) |
| `synology_login_otp_invalid.json` | `login` with a wrong code (error 404) |
| `synology_login_device_token.json` | `login` with `otp_code` and `enable_device_token=yes` (DSM 7 returns `device_id`, DSM 6 `did`) |
| `synology_system_info.json` | `SYNO.Core.System` `info` |
| `synology_storage_load_info.json` | `SYNO.Storage.CGI.Storage` `load_info` |

## Bambu Lab cloud

Test fixtures for the Bambu Lab cloud connector (`../bambu.rs`), see §8 "Bambu Lab cloud" of
[the Studio upkeep design](../../../../docs/superpowers/specs/2026-10-28-studio-upkeep-design.md).

**Documented shape, not captured from a real account.** Bambu Lab doesn't publish its cloud API. Every
`bambu_*.json` file here was written from the request and response shapes used by well-known open-source
clients (the Home Assistant `ha-bambulab` integration and similar Bambu cloud clients). Tokens, serials
and access codes are placeholders (`SCRUBBED…`). The task statuses (1 printing, 2 finished, 3 failed,
4 cancelled), times and durations are made up to cover the print-hours sum.

Pending: sign in with a real account (a P2S, region global), capture each answer (scrub `accessToken`,
`refreshToken`, `dev_id`, `dev_access_code`), and replace or add to these files. In particular check the
task `status` values, whether `costTime` is in seconds, and that `offset` pages the task list.

| File | Request |
| --- | --- |
| `bambu_login.json` | `POST /v1/user-service/user/login` that returns tokens |
| `bambu_login_verify_code.json` | the same login on an account that signs in with an emailed code (`loginType: "verifyCode"`) |
| `bambu_login_code_invalid.json` | login with a wrong code (HTTP 400) |
| `bambu_bind.json` | `GET /v1/iot-service/api/user/bind` (bound printers) |
| `bambu_tasks.json` | `GET /v1/user-service/my/tasks` (print history, one page) |

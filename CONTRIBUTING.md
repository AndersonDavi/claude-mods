# Contributing

Thanks for helping! The easiest and most welcome contribution is **a new language** for [usage-weather](usage-weather). Translation fixes, time zone shortcuts and bug fixes are welcome too.

Español: al final hay un resumen.

## Add a language

Adding a language means adding one entry to one table.

1. Fork the repo and create a branch (`add-language-it`).
2. In `usage-weather/types/index.d.ts`, add your language code to the `Idioma` type (use the two-letter ISO 639-1 code: `it`, `ru`, `tr`...).
3. In `usage-weather/hooks/register.tsx`, copy the `en` entry of `IDIOMAS`, change the key to your code and translate every field:
   - `nombre`: the language's own name (`Italiano`), shown in `/usage-weather languages`.
   - `clima`: the five forecast words, from empty to full (Clear, Cloudy, Showers, Storm, Compact soon).
   - `cache`, `sesion` (the 5-hour limit), `semana` (the weekly limit), `semanaCorta` (mini view).
   - `dias`: seven day abbreviations, **starting on Sunday**.
   - `ampm`: `['AM', 'PM']` for 12-hour clocks, `null` for 24-hour.
   - `cuenta`, `reinicia`, `ritmoOk`, `llena`: the countdown, "resets", "pace ok" and "→100% in …" texts.
   - `ctx75`, `ctx90`: the two context alerts.
   - `lbl…`, `vistas`, `zonasNota`, `invalido`, `uso`: the `/usage-weather` command texts.

   TypeScript will fail to compile if you leave a field out, because the table is typed `Record<Idioma, Textos>`.
4. Add your code to the language loop in `usage-weather/hooks/usage-weather.test.ts` and to the language tables in both READMEs.
5. Run the checks:

   ```text
   claude plugin validate usage-weather
   claude plugin test usage-weather
   ```

6. Open a pull request. Say whether you are a native speaker, and keep strings **short**: they are drawn in narrow terminals. Wide (CJK) characters are handled for you.

## Review checklist (maintainer)

A mod runs code inside Claude Code with the same access Claude Code has, so every pull request gets read, not just merged.

- A language PR should touch only the `IDIOMAS` table, the `Idioma` type, the tests and the READMEs. Anything else needs a reason.
- No new calls to `$.http`, `$.fs`, `$.process`, `$.model`, `$.agent` or `$.tool`, and no new dependencies.
- `claude plugin validate` and `claude plugin test` pass.

## Release (maintainer)

1. Bump `version` in `usage-weather/.claude-plugin/plugin.json`. Claude Code detects updates by that version, so a change without a bump does not reach users.
2. Merge to `main`.
3. Users update with:

   ```text
   /plugin marketplace update andersondavi-mods
   ```

## Resumen en español

La contribución más sencilla es **agregar un idioma** a `usage-weather`: es una entrada nueva en la tabla `IDIOMAS` de `usage-weather/hooks/register.tsx`, más el código en el tipo `Idioma` de `usage-weather/types/index.d.ts`. Copia la entrada `en`, tradúcela completa (TypeScript avisa si falta un campo), agrégala a la prueba y a los README, corre `claude plugin validate` y `claude plugin test`, y abre el pull request. Antes de aceptar uno se revisa el código, porque un mod se ejecuta con el mismo acceso que Claude Code. Para publicar, se sube `version` en `plugin.json`; los usuarios actualizan con `/plugin marketplace update andersondavi-mods`.

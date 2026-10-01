# claude-mods

<p align="center"><img src="assets/usage-weather/banner.png" alt="usage-weather: pixel-art weather icons for Clear, Cloudy, Showers, Storm and Compact soon" width="720"></p>

<p align="center"><img src="assets/usage-weather/preview-en.png" alt="The usage-weather bar above the Claude Code prompt: context, cost, cache and plan limits" width="720"></p>

<p align="center"><sub>usage-weather above the prompt. Renders drawn from the mod's real output format (sample numbers), not screenshots.</sub></p>

Mods for [Claude Code](https://claude.com/claude-code): small plugins that hook into Claude Code's events and draw their own UI. This repository is a plugin marketplace, so every mod here installs the same way.

Español: cada mod trae su `README.es.md`.

## Mods

| Mod | What it does |
|---|---|
| [usage-weather](usage-weather) | A weather forecast for your usage: context, cost, cache and Pro/Max plan limits above the prompt. 8 languages, any time zone. |

## Install a mod

```text
/plugin marketplace add AndersonDavi/claude-mods
/plugin install usage-weather@andersondavi-mods
/reload-plugins
```

If a mod does not show up, restart Claude Code. Tested on **Claude Code 2.1.287** (check yours with `claude --version`).

> A mod is code that runs inside Claude Code on your machine, with the same access Claude Code has, and it is written by its publisher, not Anthropic. Read the source before you install it, as you would with any package.

## Update

```text
/plugin marketplace update andersondavi-mods
```

## Add a new mod (for the maintainer)

1. Create a folder `my-mod/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.tsx`.
2. Add it to `.claude-plugin/marketplace.json` under `plugins`.
3. Check it: `claude plugin validate my-mod` and `claude plugin test my-mod`.

## Build your own mod

Anthropic's articles on Claude Code mods:

- [Claude Code mods](https://claude.com/blog/claude-code-mods): what mods can do and how they are shared.
- [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/): a step-by-step tutorial that builds a mod.

Inside Claude Code you can also just ask for one ("make me a mod that ..."): the built-in `plugin-authoring` skill guides Claude through writing it. Check what you wrote with `claude plugin validate <folder>` and `claude plugin test <folder>`.

## Contributing

Pull requests are welcome, above all new languages for usage-weather. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for credits.

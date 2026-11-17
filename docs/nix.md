# Installing the desktop app with Nix

The desktop app ships as an AppImage, a `.deb`, a Windows installer and a macOS
`.dmg` from the [releases page](https://github.com/barrulus/Fantasy-Map-Generator/releases).
Nix users do not need any of them: the flake builds the same app and installs it
like any other package.

Everything below needs flakes enabled. On NixOS put this in your configuration:

```nix
nix.settings.experimental-features = [ "nix-command" "flakes" ];
```

On other distributions, add `experimental-features = nix-command flakes` to
`~/.config/nix/nix.conf`.

## Just run it

Downloads, builds and launches in one step, leaving nothing installed:

```sh
nix run github:barrulus/Fantasy-Map-Generator
```

The first run takes a few minutes — mostly fetching Electron's ~250 MB runtime
from `cache.nixos.org`. Later runs start instantly.

## Install it

```sh
nix profile install github:barrulus/Fantasy-Map-Generator
```

This puts `fantasy-map-generator` on your `PATH` and installs a desktop entry, so
it also appears in your application launcher.

To update, upgrade and uninstall:

```sh
nix profile upgrade fantasy-map-generator
nix profile list                            # find the index or name
nix profile remove fantasy-map-generator
```

## Add it to a NixOS system

Add the flake as an input and pull the package into `systemPackages`:

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    fantasy-map-generator.url = "github:barrulus/Fantasy-Map-Generator";
  };

  outputs = { nixpkgs, fantasy-map-generator, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        {
          environment.systemPackages = [
            fantasy-map-generator.packages.x86_64-linux.default
          ];
        }
      ];
    };
  };
}
```

Home Manager is the same idea with `home.packages` instead of
`environment.systemPackages`.

The flake pins its own nixpkgs, so the app is built against that rather than
your system's. That costs a little disk and buys a build that does not break when
your channel moves.

## Build from a local checkout

```sh
nix build                          # result/ symlinks the built app
./result/bin/fantasy-map-generator
```

`nix develop` is a different thing — a shell with Node and the dev tooling for
working on the source, not a way to run the packaged app. See the Development
section of the [README](../README.md).

## CI and the binary cache

The [Nix package workflow](../.github/workflows/nix-build.yml) builds the Electron
desktop package on native `x86_64-linux` and `aarch64-linux` runners. It runs for
all pull requests targeting `main` and pushes to `main`, for release tags
matching `v[0-9]*`, and from **Actions → Nix package → Run workflow**.

Builds work without Cachix configured. To enable publishing:

1. Create a **public** cache in the [Cachix dashboard](https://app.cachix.org/),
   using Cachix-managed signing keys. Choose any available cache name.
2. In that cache's settings, generate a token with write access to this cache.
3. In the GitHub repository's **Settings → Secrets and variables → Actions**,
   add the token as a repository **secret** named `CACHIX_AUTH_TOKEN`, then add
   the cache name as a repository **variable** named `CACHIX_CACHE`.
4. Once the workflow is on `main`, run **Nix package** manually against `main`
   to populate the cache. Check both architecture jobs, including their Cachix
   post-job upload steps.

Pushes and manual runs on `main` or release tags publish newly built store
paths, including the app and its built dependencies. Pull requests (including
forks) and manual runs on feature branches can download from the public cache,
but receive no Cachix token and cannot upload. If `CACHIX_CACHE` is unset,
the Cachix steps are skipped; if it is set but the token is missing, publishing
runs fail with a setup error. See the
[Cachix action documentation](https://github.com/cachix/cachix-action) for its
upload behavior.

To use the public `bazgaars-fmg` cache locally:

```sh
nix run nixpkgs#cachix -- use bazgaars-fmg
nix run github:barrulus/Fantasy-Map-Generator
```

On NixOS, follow the configuration instructions printed by `cachix use` and
rebuild your system. The cache's public signing key and URL are also available
in its dashboard. Consumers of a public cache do not need the upload token.

Cache hits require the same package inputs and architecture as CI. Overriding
the flake's nixpkgs input or changing the source may require a local build.

## What you get

A wrapper around nixpkgs' `electron_43` running the renderer built from this
repo. It is the same code as the AppImage, assembled by Nix instead of by
electron-builder, which means:

- **No self-updating.** The in-app updater is inactive: a Nix store path is
  read-only, and an app that rewrites itself would defeat the point. Update
  through Nix, as above.
- **No bundled Chromium.** Electron comes from `cache.nixos.org` and is shared
  with every other Electron app on your system, instead of a private copy inside
  an AppImage.
- **Your maps are unaffected.** They live in
  `~/.config/fantasy-map-generator`, outside the store, and survive updates and
  uninstalls. The AppImage and the Nix build read the same directory, so you can
  switch between them without losing anything.

## Platform support

Linux only. CI builds and checks the package contents for `x86_64-linux` and
`aarch64-linux`; it does not launch the graphical app. Interactive testing has
been done on `x86_64-linux`, not on `aarch64-linux`.

macOS is deliberately excluded. The package wraps a bare Electron binary, which
is not a macOS `.app` bundle — the dock, the menu bar and file associations all
expect one. Use the `.dmg` from the releases page instead. (`nix develop` still
works on macOS for development.)

## Troubleshooting

**`error: experimental Nix feature 'nix-command' is disabled`** — enable flakes,
see the top of this page.

**`error: flake 'github:...' does not provide attribute 'packages.x86_64-darwin.default'`**
— you are on macOS; see Platform support.

**The window is blank, or fails on a Wayland session** — force X11 through
XWayland:

```sh
NIXOS_OZONE_WL= fantasy-map-generator
```

The wrapper enables native Wayland only when `NIXOS_OZONE_WL` is set, so
clearing it falls back to XWayland.

**Very large maps die with `V8 javascript OOM` in the terminal** — the renderer
ran out of heap. The desktop app raises V8's default cap of about 4 GB to 16 GB,
so this needs a map of several million cells plus a layer redraw. Reduce the
cell count or keep fewer layers on; the polygon layers are drawn whole.

**Stale build after pulling** — Nix caches by flake revision. Refresh it:

```sh
nix run --refresh github:barrulus/Fantasy-Map-Generator
```

{
  description = "Azgaar's Fantasy Map Generator";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      # x86_64-darwin is absent because nixpkgs 26.11 dropped it: naming it here
      # makes every output for that system throw rather than simply not exist
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # the package wraps a bare Electron, which is not a macOS .app bundle, so it is
      # offered only where it can actually run; `nix develop` still works everywhere
      linuxSystems = nixpkgs.lib.filter (nixpkgs.lib.hasSuffix "-linux") systems;
      forLinuxSystems = f: nixpkgs.lib.genAttrs linuxSystems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forLinuxSystems (pkgs: {
        fantasy-map-generator = pkgs.callPackage ./nix/package.nix { };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.fantasy-map-generator;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
          ];

          shellHook = ''
            echo ""
            echo "=== Fantasy Map Generator ==="
            echo ""
            echo "Available commands:"
            echo "  npm run dev         - Start dev server (http://localhost:5173)"
            echo "  npm run build       - Type-check + production build"
            echo "  npm run preview     - Preview production build"
            echo "  npm run electron    - Run the desktop app against the dev server"
            echo "  npm test            - Run tests"
            echo "  tsc --noEmit        - Type-check only"
            echo ""
            echo "  nix build           - Build the desktop app as a Nix package"
            echo ""
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}

{
  description = "Azgaar's Fantasy Map Generator";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
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

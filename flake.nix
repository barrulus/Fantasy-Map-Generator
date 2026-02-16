{
  description = "Azgaar's Fantasy Map Generator";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in
    {
      devShells.x86_64-linux.default = pkgs.mkShell {
        buildInputs = with pkgs; [
          nodejs
        ];

        shellHook = ''
          echo ""
          echo "=== Fantasy Map Generator ==="
          echo ""
          echo "Available commands:"
          echo "  npm run dev      - Start dev server (http://localhost:5173)"
          echo "  npm run build    - Type-check + production build"
          echo "  npm run preview  - Preview production build"
          echo "  npm test         - Run tests"
          echo "  tsc --noEmit     - Type-check only"
          echo ""
        '';
      };
    };
}

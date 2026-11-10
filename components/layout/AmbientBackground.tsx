/**
 * Fixed futuristic atmosphere behind every page: slow aurora (DOOM blue/cyan/orange),
 * circuit traces echoing the official logo, and a perspective grid floor.
 * Pure CSS (no JS), aria-hidden, composited animations on desktop only, static on mobile,
 * frozen by prefers-reduced-motion. Styles: `.doom-ambient*` in app/globals.css.
 */
export function AmbientBackground() {
  return (
    <div className="doom-ambient" aria-hidden="true">
      <div className="doom-ambient__aurora" />
      <div className="doom-ambient__circuit" />
      <div className="doom-ambient__floor">
        <div className="doom-ambient__plane" />
      </div>
    </div>
  );
}

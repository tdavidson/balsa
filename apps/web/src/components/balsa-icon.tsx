export function BalsaIcon({ className = "", decorative = false }: { className?: string; decorative?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="88 72 458 608" width="28" height="32" className={className} role={decorative ? undefined : "img"} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : "Balsa"}>
      <g fill="currentColor">
<path fill="currentColor" d="
    M110 82
    Q98 82 98 96
    L98 198
    Q98 207 107 212
    L323 337
    Q333 343 345 343
    L392 343
    C481 343 536 292 536 212
    C536 133 480 82 392 82
    Z"/>
<path fill="currentColor" d="
    M107 270
    Q98 265 98 277
    L98 536
    Q98 547 108 552
    L292 658
    Q306 666 306 649
    L306 404
    Q306 392 296 386
    Z"/>
<path fill="currentColor" d="
    M365 402
    Q351 402 351 416
    L351 649
    Q351 666 365 658
    L445 612
    C503 579 536 528 536 466
    C536 427 520 402 488 402
    Z"/>
      </g>
    </svg>
  );
}

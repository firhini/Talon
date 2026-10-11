/** Pixel-art bird-of-prey talon: 20x20 grid of <rect>s, crisp edges, fixed bottom-right. */
const SPRITE = [
  "........Yy..........",
  "........Yy..........",
  "........YYy.........",
  ".......wYYy.........",
  ".......wYYYy........",
  "......wYYYYYy.......",
  ".....wYY.YYYYy......",
  "....wYY..Yy.YYy.....",
  "...wYY...Yy..YYy....",
  "..wYY....Yy...YYy...",
  "..YY.....Yy....YYy..",
  ".KK......Yy.....KKk.",
  "KKk......KKk.....KKk",
  "Kk.......KKk......Kk",
  "Kk......KKKk......Kk",
  ".Kk.....KKk......Kk.",
  "........Kk..........",
];
const COLORS: Record<string, string> = {
  Y: "#e2a62e", // foot
  y: "#b47d19", // foot shade
  w: "#f6cf6c", // foot highlight
  K: "#c9ced8", // claw (steel)
  k: "#6f7684", // claw shade
};

export default function Mascot() {
  const rects: React.ReactNode[] = [];
  SPRITE.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = COLORS[ch];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    });
  });
  return (
    <div className="pointer-events-auto fixed right-4 bottom-4 z-40 opacity-80 transition-opacity hover:opacity-100" title="TALON" aria-hidden="true">
      <svg width={96} height={96} viewBox="0 0 20 20" shapeRendering="crispEdges" role="img">
        <title>TALON</title>
        {rects}
      </svg>
    </div>
  );
}

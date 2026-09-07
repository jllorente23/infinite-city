import dynamic from 'next/dynamic';

// WebGL and the physics WASM only exist in the browser
const Game = dynamic(() => import('@/components/Game'), { ssr: false });

export default function Page() {
  return <Game />;
}

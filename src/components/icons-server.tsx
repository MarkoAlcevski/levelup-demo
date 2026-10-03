import {
  Barbell, Bicycle, BookOpenText, Brain, Briefcase, Camera, ChartLineUp, Church, Code, Coffee, Compass, Flask,
  GameController, Globe, GraduationCap, Hammer, Handshake, Heart, Heartbeat, Hexagon, House, Leaf, Lightning, Megaphone,
  Microphone, Moon, MusicNotes, PaintBrush, PenNib, PersonSimpleRun, Plant, Rocket, SoccerBall, Sparkle, Star, Sun,
  SwimmingPool, Target, UsersThree, VideoCamera, Wallet, Wrench,
} from '@phosphor-icons/react/dist/ssr';
import { areaIcon, type AreaIconKey } from '@/lib/modules';

const MAP: Record<AreaIconKey, typeof Hexagon> = {
  barbell: Barbell, wallet: Wallet, hexagon: Hexagon, briefcase: Briefcase, code: Code, rocket: Rocket, pen: PenNib,
  camera: Camera, music: MusicNotes, microphone: Microphone, video: VideoCamera, paint: PaintBrush, book: BookOpenText,
  graduation: GraduationCap, brain: Brain, flask: Flask, chart: ChartLineUp, megaphone: Megaphone, handshake: Handshake,
  target: Target, lightning: Lightning, star: Star, run: PersonSimpleRun, bicycle: Bicycle, swim: SwimmingPool,
  soccer: SoccerBall, heartbeat: Heartbeat, heart: Heart, leaf: Leaf, plant: Plant, moon: Moon, sun: Sun, church: Church,
  house: House, users: UsersThree, compass: Compass, globe: Globe, coffee: Coffee, game: GameController, hammer: Hammer,
  wrench: Wrench, sparkle: Sparkle,
};

/** Server-component version of AreaIcon (Phosphor's SSR build has no context/hooks). */
export function AreaIconServer({ kind, icon, size = 16, className }: { kind: string; icon?: string | null; size?: number; className?: string }) {
  const I = MAP[areaIcon(kind, icon)];
  return <I size={size} className={className} aria-hidden />;
}

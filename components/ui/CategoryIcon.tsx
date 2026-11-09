import {
  BatteryCharging,
  Bluetooth,
  Box,
  Cable,
  Cpu,
  Gamepad2,
  Headphones,
  Laptop,
  LayoutGrid,
  Monitor,
  PlugZap,
  Shield,
  Smartphone,
  Speaker,
  type LucideIcon,
} from 'lucide-react';

/** Icon keys stored in `Category.icon`. Add new keys here (whitelist keeps the bundle small). */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  laptop: Laptop,
  headphones: Headphones,
  cable: Cable,
  'plug-zap': PlugZap,
  'battery-charging': BatteryCharging,
  shield: Shield,
  'gamepad-2': Gamepad2,
  monitor: Monitor,
  box: Box,
  cpu: Cpu,
  bluetooth: Bluetooth,
  speaker: Speaker,
};

export function CategoryIcon({ name, size = 20, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const Icon = (name && CATEGORY_ICONS[name]) || LayoutGrid;
  return <Icon size={size} aria-hidden="true" className={className} />;
}

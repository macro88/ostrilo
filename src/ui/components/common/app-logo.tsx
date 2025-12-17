import mascotLogo from "@/assets/ostrilo_front.svg";

interface AppLogoProps {
  className?: string;
  size?: number;
  alt?: string;
}

export function AppLogo({
  className = "",
  size = 48,
  alt = "Ostrilo Mascot",
}: AppLogoProps) {
  return (
    <img
      src={mascotLogo}
      alt={alt}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

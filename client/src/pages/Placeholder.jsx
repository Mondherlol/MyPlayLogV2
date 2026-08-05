import { Construction } from "lucide-react";

export default function Placeholder({ title, Icon }) {
  return (
    <div className="placeholder">
      <div className="placeholder-icon">
        {Icon ? <Icon size={34} strokeWidth={2} /> : <Construction size={34} />}
      </div>
      <h1 className="placeholder-title">{title}</h1>
      <p className="placeholder-sub font-fun">Cette section arrive très vite…</p>
    </div>
  );
}

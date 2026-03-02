import { cn } from '@/lib/utils';
import { MessageSquare, CheckSquare, Activity, User, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import holdlessHLogo from '@/assets/holdless-h-logo-new.png';
export type DashboardTab = 'ai-chat' | 'tasks' | 'activity' | 'profile' | 'settings';
interface DashboardSidebarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  collapsed?: boolean;
  taskBadge?: number | null;
}
const navItems: {
  key: DashboardTab;
  label: string;
  icon: typeof MessageSquare;
}[] = [{
  key: 'ai-chat',
  label: 'AI Chat',
  icon: MessageSquare
}, {
  key: 'tasks',
  label: 'Tasks',
  icon: CheckSquare
}, {
  key: 'activity',
  label: 'Activity',
  icon: Activity
}, {
  key: 'profile',
  label: 'Profile',
  icon: User
}];
export function DashboardSidebar({
  activeTab,
  onTabChange,
  collapsed = false,
  taskBadge = null
}: DashboardSidebarProps) {
  const navigate = useNavigate();
  return <aside className={cn("min-h-screen flex flex-col transition-all duration-300 ease-in-out border-r border-sidebar-border", collapsed ? "w-16" : "w-64")} style={{
    background: 'linear-gradient(180deg, hsl(260 27% 96%) 0%, hsl(220 40% 96%) 25%, hsl(250 35% 95%) 50%, hsl(215 45% 95%) 75%, hsl(257 40% 93%) 100%)'
  }}>
      {/* Logo */}
      <div className={cn("flex items-center cursor-pointer transition-all duration-300 opacity-100", collapsed ? "justify-center py-5" : "px-5 py-5")} onClick={() => navigate('/')}>
        <img alt="Holdless" className={cn("object-contain transition-all duration-300", collapsed ? "w-10 h-10" : "w-12 h-12")} src="/lovable-uploads/3a2790b3-313f-4b8f-a724-13962a845d82.png" />
        <span className={cn("text-lg font-semibold text-sidebar-foreground transition-all duration-300 overflow-hidden whitespace-nowrap -ml-1", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
          Holdless
        </span>
      </div>

      {/* Divider */}
      <div className={cn("h-px bg-sidebar-border transition-all duration-300", collapsed ? "mx-4 mb-4" : "mx-5 mb-2")} />

      {/* Navigation */}
      <nav className={cn("flex-1 transition-all duration-300 bg-zinc-50/[0.16]", collapsed ? "px-3 py-2" : "px-3 py-2")}>
        <ul className="space-y-1">
          {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          const showBadge = item.key === 'tasks' && taskBadge !== null && taskBadge > 0;
          return <li key={item.key}>
                <button onClick={() => onTabChange(item.key)} className={cn("w-full flex items-center rounded-xl text-sm font-medium transition-all duration-200 relative", collapsed ? "justify-center h-10" : "gap-3 px-3 py-2.5", isActive ? "bg-[hsl(255_25%_92%)] text-[hsl(250_50%_40%)]" : "text-sidebar-foreground/70 hover:bg-[hsl(255_20%_94%)] hover:text-sidebar-foreground")} title={collapsed ? item.label : undefined}>
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className={cn("transition-all duration-300 overflow-hidden whitespace-nowrap", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
                    {item.label}
                  </span>
                  {/* +1 Badge */}
                  {showBadge && <span className={cn("bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center animate-scale-in", collapsed ? "absolute -top-1 -right-1 w-5 h-5" : "ml-auto px-2 py-0.5")}>
                      +{taskBadge}
                    </span>}
                </button>
              </li>;
        })}
        </ul>
      </nav>

      {/* Settings at bottom */}
      <div className={cn("border-t border-sidebar-border transition-all duration-300", collapsed ? "px-3 py-4" : "px-3 py-4")}>
        <button onClick={() => onTabChange('settings')} className={cn("w-full flex items-center rounded-xl text-sm font-medium transition-all duration-200", collapsed ? "justify-center h-10" : "gap-3 px-3 py-2.5", activeTab === 'settings' ? "bg-[hsl(255_25%_92%)] text-[hsl(250_50%_40%)]" : "text-sidebar-foreground/70 hover:bg-[hsl(255_20%_94%)] hover:text-sidebar-foreground")} title={collapsed ? "Settings" : undefined}>
          <Settings className="w-5 h-5 flex-shrink-0" />
          <span className={cn("transition-all duration-300 overflow-hidden whitespace-nowrap", collapsed ? "w-0 opacity-0" : "w-auto opacity-100")}>
            Settings
          </span>
        </button>
      </div>

      {/* Footer tagline */}
      <div className={cn("px-5 pb-4 transition-all duration-300 overflow-hidden", collapsed ? "h-0 opacity-0" : "h-auto opacity-100")}>
        <p className="text-xs text-sidebar-foreground/50 whitespace-nowrap">AI customer service assistant</p>
      </div>
    </aside>;
}
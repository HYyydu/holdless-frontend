import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, PawPrint } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

interface HeaderProps {
  activeTab: 'tasks' | 'profile';
  onTabChange: (tab: 'tasks' | 'profile') => void;
  pendingTasksCount: number;
}

export function Header({ activeTab, onTabChange, pendingTasksCount }: HeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isPetPage = location.pathname === '/pet';

  const handleLogoClick = () => {
    navigate('/');
  };

  const handlePetClick = () => {
    navigate('/pet');
  };

  const handleDashboardClick = () => {
    navigate('/dashboard');
  };

  return (
    <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-10 shadow-card">
      <div className="container max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div 
            className="flex items-center gap-3 cursor-pointer" 
            onClick={handleLogoClick}
          >
            <img 
              src="/assets/holdless-logo.svg" 
              alt="Holdless logo" 
              className="w-10 h-10"
            />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Holdless</h1>
              <p className="text-sm text-muted-foreground">Your AI customer service assistant</p>
            </div>
          </div>
          
          <nav className="flex items-center gap-1">
            {!isPetPage && (
              <>
                <Button
                  variant={activeTab === 'tasks' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => { handleDashboardClick(); onTabChange('tasks'); }}
                  className="relative"
                >
                  Tasks
                  {pendingTasksCount > 0 && (
                    <Badge 
                      variant="destructive" 
                      className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
                    >
                      {pendingTasksCount}
                    </Badge>
                  )}
                </Button>
                <Button
                  variant={activeTab === 'profile' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => onTabChange('profile')}
                >
                  <User className="w-4 h-4" />
                  Profile
                </Button>
              </>
            )}
            {isPetPage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDashboardClick}
              >
                Tasks
              </Button>
            )}
            <Button
              variant={isPetPage ? 'default' : 'ghost'}
              size="sm"
              onClick={handlePetClick}
              className={isPetPage ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'}
            >
              <PawPrint className="w-4 h-4" />
              Pet
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
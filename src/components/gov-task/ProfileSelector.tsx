import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Plus, Check, Trash2 } from "lucide-react";
import { GovProfile } from "@/hooks/useGovProfiles";

interface ProfileSelectorProps {
  profiles: GovProfile[];
  selectedProfileId: string | null;
  onSelectProfile: (profile: GovProfile | null) => void;
  onCreateNew: () => void;
  onDeleteProfile: (id: string) => void;
}

export function ProfileSelector({
  profiles,
  selectedProfileId,
  onSelectProfile,
  onCreateNew,
  onDeleteProfile,
}: ProfileSelectorProps) {
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Select a saved profile or enter new information
        </p>
      </div>

      {profiles.length > 0 && (
        <ScrollArea className="max-h-[180px]">
          <div className="space-y-2 pr-2">
            {profiles.map((profile) => (
              <Card
                key={profile.id}
                className={`cursor-pointer transition-smooth hover:shadow-elegant ${
                  selectedProfileId === profile.id
                    ? 'ring-2 ring-primary bg-primary/5'
                    : 'hover:border-primary/40'
                }`}
                onClick={() => onSelectProfile(selectedProfileId === profile.id ? null : profile)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm truncate">{profile.name}</h4>
                          {selectedProfileId === profile.id && (
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.fullName} • {profile.state}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          DOB: {formatDate(profile.dateOfBirth)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteProfile(profile.id);
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      )}

      <Button
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={onCreateNew}
      >
        <Plus className="w-4 h-4" />
        {profiles.length > 0 ? 'Enter new information' : 'Enter your information'}
      </Button>
    </div>
  );
}

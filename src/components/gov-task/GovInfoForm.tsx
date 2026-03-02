import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar, Save, User, Sparkles } from "lucide-react";
import { GovProfile } from "@/hooks/useGovProfiles";
import { useUserProfile } from "@/hooks/useUserProfile";

// US States for dropdown
const usStates = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", 
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", 
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", 
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", 
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", 
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", 
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", 
  "Wisconsin", "Wyoming", "District of Columbia"
];

// License issue types for Driver's License
const licenseIssueTypes = [
  "Renewal",
  "New application",
  "Replacement (lost/stolen)",
  "Name change",
  "Address change",
  "Upgrade/Endorsement",
  "Reinstatement",
  "Other"
];

interface GovInfoFormProps {
  // Required fields
  fullName: string;
  setFullName: (value: string) => void;
  dateOfBirth: string;
  setDateOfBirth: (value: string) => void;
  state: string;
  setState: (value: string) => void;
  zipCode: string;
  setZipCode: (value: string) => void;
  // Optional fields
  licenseNumber: string;
  setLicenseNumber: (value: string) => void;
  licenseIssueType: string;
  setLicenseIssueType: (value: string) => void;
  // Call Goal (Optional)
  callGoal: string;
  setCallGoal: (value: string) => void;
  // Save profile
  saveAsProfile: boolean;
  setSaveAsProfile: (value: boolean) => void;
  profileName: string;
  setProfileName: (value: string) => void;
  showSaveOption: boolean;
  isEditingExisting?: boolean;
  // Autofill from profiles (legacy)
  profiles?: GovProfile[];
  onAutofillFromProfile?: (profile: GovProfile) => void;
}

export function GovInfoForm({
  fullName,
  setFullName,
  dateOfBirth,
  setDateOfBirth,
  state,
  setState,
  zipCode,
  setZipCode,
  licenseNumber,
  setLicenseNumber,
  licenseIssueType,
  setLicenseIssueType,
  callGoal,
  setCallGoal,
  saveAsProfile,
  setSaveAsProfile,
  profileName,
  setProfileName,
  showSaveOption,
  isEditingExisting = false,
  profiles = [],
  onAutofillFromProfile,
}: GovInfoFormProps) {
  // Access global user profile for "Use Profile Info"
  const { profile: userProfile, hasEssentialInfo } = useUserProfile();
  
  const handleUseProfileInfo = () => {
    if (userProfile) {
      setFullName(userProfile.name);
      setDateOfBirth(userProfile.dateOfBirth);
      setState(userProfile.state);
      setZipCode(userProfile.zipCode);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Required Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="destructive" className="text-xs font-medium">Required</Badge>
          
          {/* Use Profile Info Button - Primary autofill from main profile */}
          {hasEssentialInfo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUseProfileInfo}
              className="h-9 px-4 gap-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all"
            >
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-primary font-medium">Use Profile Info</span>
            </Button>
          )}
        </div>
        
        <div className="space-y-4">
          {/* Full Legal Name */}
          <div className="space-y-2">
            <Label htmlFor="gov-full-name" className="text-sm font-medium text-foreground">
              Full Legal Name
            </Label>
            <Input 
              id="gov-full-name"
              placeholder="Enter your full legal name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-11 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
            />
          </div>
          
          {/* Date of Birth */}
          <div className="space-y-2">
            <Label htmlFor="gov-dob" className="text-sm font-medium text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Date of Birth
            </Label>
            <Input 
              id="gov-dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-11 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
            />
          </div>
          
          {/* State & ZIP Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gov-state" className="text-sm font-medium text-foreground">State</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger id="gov-state" className="h-11 border-border/60 focus:border-primary/50">
                  <SelectValue placeholder="Select your state" />
                </SelectTrigger>
                <SelectContent>
                  {usStates.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="gov-zip" className="text-sm font-medium text-foreground">ZIP Code</Label>
              <Input 
                id="gov-zip"
                placeholder="e.g. 10001"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                maxLength={10}
                className="h-11 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>
        </div>
      </div>
      
      {/* Optional Section */}
      <div className="space-y-4 pt-4 border-t border-border/50">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs font-medium bg-muted/80">Optional</Badge>
          <span className="text-xs text-muted-foreground">Helps speed up the call</span>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="gov-license-number" className="text-sm font-medium text-foreground">
              Driver's License Number
            </Label>
            <Input 
              id="gov-license-number"
              placeholder="Enter your license number"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="h-11 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="gov-license-issue" className="text-sm font-medium text-foreground">
              Type of License Issue
            </Label>
            <Select value={licenseIssueType} onValueChange={setLicenseIssueType}>
              <SelectTrigger id="gov-license-issue" className="h-11 border-border/60 focus:border-primary/50">
                <SelectValue placeholder="Select issue type" />
              </SelectTrigger>
              <SelectContent>
                {licenseIssueTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      
      {/* Call Goal Section */}
      <div className="space-y-4 pt-4 border-t border-border/50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Call Goal</span>
          <Badge variant="secondary" className="text-xs font-medium bg-muted/80">Optional</Badge>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Helps the agent understand your priorities
        </p>
        
        <Textarea 
          id="gov-call-goal"
          placeholder="What do you want to achieve? e.g. Renew my license before it expires next month"
          value={callGoal}
          onChange={(e) => setCallGoal(e.target.value)}
          className="min-h-[88px] border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all resize-none"
        />
      </div>

      {/* Save Profile Option */}
      {showSaveOption && (
        <div className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center space-x-3">
            <Checkbox 
              id="save-profile" 
              checked={saveAsProfile}
              onCheckedChange={(checked) => setSaveAsProfile(checked as boolean)}
              className="border-border/60"
            />
            <label
              htmlFor="save-profile"
              className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2 text-foreground"
            >
              <Save className="w-4 h-4 text-muted-foreground" />
              Save this information for future tasks
            </label>
          </div>
          
          {saveAsProfile && (
            <div className="space-y-2 pl-7">
              <Label htmlFor="profile-name" className="text-sm font-medium text-foreground">
                Profile Name
              </Label>
              <Input 
                id="profile-name"
                placeholder="e.g. My Profile, John's Info"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="h-11 border-border/60 focus:border-primary/50 focus:ring-primary/20 transition-all"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

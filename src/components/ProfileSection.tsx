import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  Shield, 
  Link as LinkIcon,
  Settings,
  CreditCard,
  Package,
  CheckCircle,
  AlertTriangle,
  Calendar,
  IdCard
} from "lucide-react";

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

interface ConnectedAccount {
  id: string;
  provider: string;
  email: string;
  status: 'connected' | 'error' | 'pending';
  lastSync?: Date;
}

interface ProfileSectionProps {
  profile: {
    name: string;
    email: string;
    phone: string;
    address: string;
    dateOfBirth: string;
    state: string;
    zipCode: string;
    tone: string;
    language: string;
  };
  connectedAccounts: ConnectedAccount[];
  onUpdateProfile: (field: string, value: string) => void;
  onConnectAccount: (provider: string) => void;
}

export function ProfileSection({ profile, connectedAccounts, onUpdateProfile, onConnectAccount }: ProfileSectionProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return <CheckCircle className="w-4 h-4 text-accent" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-destructive" />;
      default: return <AlertTriangle className="w-4 h-4 text-warning" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'success';
      case 'error': return 'destructive';
      default: return 'warning';
    }
  };

  return (
    <div className="space-y-6">
      {/* Personal Information */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Name & Email Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium text-foreground">Full Name</Label>
              <Input 
                id="name"
                value={profile.name}
                onChange={(e) => onUpdateProfile('name', e.target.value)}
                className="h-11 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">Email</Label>
              <Input 
                id="email"
                type="email"
                value={profile.email}
                onChange={(e) => onUpdateProfile('email', e.target.value)}
                className="h-11 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
          </div>
          
          {/* Date of Birth & Phone Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth" className="text-sm font-medium text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Date of Birth
              </Label>
              <Input 
                id="dateOfBirth"
                type="date"
                value={profile.dateOfBirth}
                onChange={(e) => onUpdateProfile('dateOfBirth', e.target.value)}
                className="h-11 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-medium text-foreground flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                Phone Number
              </Label>
              <Input 
                id="phone"
                type="tel"
                value={profile.phone}
                onChange={(e) => onUpdateProfile('phone', e.target.value)}
                className="h-11 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
          </div>
          
          {/* State & ZIP Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="state" className="text-sm font-medium text-foreground flex items-center gap-2">
                <IdCard className="w-4 h-4 text-muted-foreground" />
                State
              </Label>
              <Select value={profile.state} onValueChange={(value) => onUpdateProfile('state', value)}>
                <SelectTrigger id="state" className="h-11 border-border/60 focus:border-primary/50">
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
              <Label htmlFor="zipCode" className="text-sm font-medium text-foreground">ZIP Code</Label>
              <Input 
                id="zipCode"
                value={profile.zipCode}
                onChange={(e) => onUpdateProfile('zipCode', e.target.value)}
                placeholder="e.g. 90007"
                maxLength={10}
                className="h-11 border-border/60 focus:border-primary/50 transition-colors"
              />
            </div>
          </div>
          
          {/* Address Row */}
          <div className="space-y-2">
            <Label htmlFor="address" className="text-sm font-medium text-foreground flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              Default Address
            </Label>
            <Input 
              id="address"
              value={profile.address}
              onChange={(e) => onUpdateProfile('address', e.target.value)}
              className="h-11 border-border/60 focus:border-primary/50 transition-colors"
            />
          </div>
          
          {/* Tone & Language Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/50">
            <div className="space-y-2">
              <Label htmlFor="tone" className="text-sm font-medium text-foreground">Communication Tone</Label>
              <Select value={profile.tone} onValueChange={(value) => onUpdateProfile('tone', value)}>
                <SelectTrigger className="h-11 border-border/60 focus:border-primary/50">
                  <SelectValue placeholder="Select tone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="polite">Polite</SelectItem>
                  <SelectItem value="firm">Firm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="language" className="text-sm font-medium text-foreground">Preferred Language</Label>
              <Select value={profile.language} onValueChange={(value) => onUpdateProfile('language', value)}>
                <SelectTrigger className="h-11 border-border/60 focus:border-primary/50">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="english">English</SelectItem>
                  <SelectItem value="spanish">Spanish</SelectItem>
                  <SelectItem value="chinese">Chinese</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connected Accounts */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            Connected Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Link your accounts to automatically fetch order information and streamline support requests.
          </p>
          
          <div className="space-y-3">
            {connectedAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    {account.provider === 'Amazon' && <Package className="w-5 h-5 text-primary" />}
                    {account.provider === 'Google' && <Mail className="w-5 h-5 text-primary" />}
                  </div>
                  <div>
                    <h3 className="font-medium">{account.provider}</h3>
                    <p className="text-sm text-muted-foreground">{account.email}</p>
                    {account.lastSync && (
                      <p className="text-xs text-muted-foreground">
                        Last sync: {account.lastSync.toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(account.status)}
                  <Badge variant={getStatusColor(account.status) as any}>
                    {account.status}
                  </Badge>
                </div>
              </div>
            ))}
            
            {/* Add New Account Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={() => onConnectAccount('Amazon')}
                disabled={connectedAccounts.some(a => a.provider === 'Amazon')}
              >
                <Package className="w-4 h-4" />
                Connect Amazon
              </Button>
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={() => onConnectAccount('Google')}
                disabled={connectedAccounts.some(a => a.provider === 'Google')}
              >
                <Mail className="w-4 h-4" />
                Connect Google
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Privacy & Security */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Privacy & Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="recording">Allow Call Recording</Label>
                <p className="text-sm text-muted-foreground">
                  Record calls for quality assurance and transcript generation
                </p>
              </div>
              <Switch id="recording" />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="notifications">Push Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Get notified when tasks need your input or are completed
                </p>
              </div>
              <Switch id="notifications" defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="data-sharing">Smart Data Sharing</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically share relevant order details with vendors
                </p>
              </div>
              <Switch id="data-sharing" defaultChecked />
            </div>
          </div>
          
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Your data is encrypted and we only share the minimum information needed to resolve your support requests. 
              Read our privacy policy for details.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Trophy, 
  Clock, 
  DollarSign, 
  FileCheck, 
  Share2, 
  X,
  Sparkles,
  MessageCircle,
  Twitter,
  Facebook,
  Link2,
  CheckCircle2
} from "lucide-react";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export interface WinData {
  headline: string;
  whatHappened: string;
  timeSaved: string;
  moneySaved?: string;
  moneyRecovered?: string;
  priceRange?: string;
  bestQuote?: string;
  topClinicName?: string;
  proof: string;
  proofLabel: string;
  appointmentTime?: string;
  vendor?: string;
}

interface HoldlessWinModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  winData: WinData | null;
}

// Confetti particle component
const ConfettiParticle = ({ delay, left }: { delay: number; left: number }) => {
  const colors = ['#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  
  return (
    <div
      className="absolute w-2 h-2 rounded-full animate-confetti"
      style={{
        left: `${left}%`,
        backgroundColor: color,
        animationDelay: `${delay}ms`,
        top: '-10px',
      }}
    />
  );
};

export function HoldlessWinModal({ open, onOpenChange, winData }: HoldlessWinModalProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!winData) return null;

  const shareText = `🎉 ${winData.headline}! Holdless saved me ${winData.timeSaved} and ${winData.moneySaved || winData.moneyRecovered || winData.bestQuote || 'got the job done'}. Never wait on hold again! #Holdless`;
  
  const shareUrl = "https://holdless.lovable.app";

  const handleShare = (platform: string) => {
    const encodedText = encodeURIComponent(shareText);
    const encodedUrl = encodeURIComponent(shareUrl);
    
    let url = '';
    switch (platform) {
      case 'twitter':
        url = `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
        break;
      case 'facebook':
        url = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
        break;
      case 'message':
        url = `sms:?body=${encodedText} ${shareUrl}`;
        break;
      case 'copy':
        navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
        setCopied(true);
        toast.success("Link copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
        return;
    }
    
    if (url) {
      window.open(url, '_blank', 'width=600,height=400');
    }
  };

  // Determine which money metric to show
  const getMoneyMetric = () => {
    if (winData.moneyRecovered) {
      return { label: "Money Recovered", value: winData.moneyRecovered };
    }
    if (winData.moneySaved) {
      return { label: "Money Saved", value: winData.moneySaved };
    }
    if (winData.bestQuote) {
      return { label: "Best Quote", value: winData.bestQuote };
    }
    if (winData.priceRange) {
      return { label: "Price Range", value: winData.priceRange };
    }
    return { label: "Value", value: "—" };
  };

  // Determine proof metric
  const getProofMetric = () => {
    if (winData.appointmentTime) {
      return { label: "Appointment", value: winData.appointmentTime };
    }
    if (winData.topClinicName) {
      return { label: "Top Clinic", value: winData.topClinicName };
    }
    return { label: winData.proofLabel, value: winData.proof };
  };

  const moneyMetric = getMoneyMetric();
  const proofMetric = getProofMetric();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden border-0 bg-transparent shadow-none">
        <Card className="relative overflow-hidden border-2 border-amber-200 shadow-2xl">
          {/* Confetti Container */}
          {showConfetti && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
              {Array.from({ length: 30 }).map((_, i) => (
                <ConfettiParticle 
                  key={i} 
                  delay={i * 100} 
                  left={Math.random() * 100} 
                />
              ))}
            </div>
          )}

          {/* Close Button */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 z-50 rounded-full p-1.5 bg-white/80 hover:bg-white shadow-sm transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          {/* Celebratory Header */}
          <div className="relative bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-400 px-6 pt-8 pb-6">
            {/* Sparkle decorations */}
            <Sparkles className="absolute top-4 left-4 w-5 h-5 text-white/60 animate-pulse" />
            <Sparkles className="absolute top-8 right-12 w-4 h-4 text-white/40 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <Sparkles className="absolute bottom-4 left-12 w-3 h-3 text-white/50 animate-pulse" style={{ animationDelay: '1s' }} />

            {/* Logo & Tagline */}
            <div className="flex items-center gap-2 mb-4">
              <img 
                src="/assets/holdless-logo.svg" 
                alt="Holdless" 
                className="w-8 h-8 rounded-lg shadow-md"
              />
              <div>
                <span className="font-bold text-white text-sm">Holdless</span>
                <p className="text-xs text-white/80">We hold so you don't have to.</p>
              </div>
            </div>

            {/* Trophy Icon */}
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-lg">
                <Trophy className="w-9 h-9 text-white drop-shadow-md" />
              </div>
            </div>

            {/* Headline */}
            <h2 className="text-2xl font-bold text-white text-center drop-shadow-sm">
              {winData.headline}
            </h2>
            
            {winData.vendor && (
              <Badge className="mx-auto mt-2 bg-white/20 text-white border-white/30 backdrop-blur-sm block w-fit">
                {winData.vendor}
              </Badge>
            )}
          </div>

          {/* Metrics Section */}
          <div className="px-6 py-5 bg-gradient-to-b from-amber-50 to-white">
            <div className="grid grid-cols-3 gap-3">
              {/* Time Saved */}
              <div className="bg-white rounded-xl p-3 border border-amber-100 shadow-sm text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <Clock className="w-4 h-4 text-blue-600" />
                </div>
                <p className="text-xs text-muted-foreground mb-0.5">Time Saved</p>
                <p className="font-bold text-foreground text-sm">{winData.timeSaved}</p>
              </div>

              {/* Money Metric */}
              <div className="bg-white rounded-xl p-3 border border-amber-100 shadow-sm text-center">
                <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-xs text-muted-foreground mb-0.5">{moneyMetric.label}</p>
                <p className="font-bold text-foreground text-sm">{moneyMetric.value}</p>
              </div>

              {/* Proof */}
              <div className="bg-white rounded-xl p-3 border border-amber-100 shadow-sm text-center">
                <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mx-auto mb-2">
                  <FileCheck className="w-4 h-4 text-purple-600" />
                </div>
                <p className="text-xs text-muted-foreground mb-0.5">{proofMetric.label}</p>
                <p className="font-bold text-foreground text-sm truncate" title={proofMetric.value}>
                  {proofMetric.value}
                </p>
              </div>
            </div>

            {/* What Happened */}
            <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800">{winData.whatHappened}</p>
              </div>
            </div>
          </div>

          {/* Share Section */}
          <div className="px-6 pb-6 bg-white">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Your Win
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48">
                <DropdownMenuItem onClick={() => handleShare('twitter')}>
                  <Twitter className="w-4 h-4 mr-2 text-[#1DA1F2]" />
                  Share on Twitter
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleShare('facebook')}>
                  <Facebook className="w-4 h-4 mr-2 text-[#4267B2]" />
                  Share on Facebook
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleShare('message')}>
                  <MessageCircle className="w-4 h-4 mr-2 text-green-600" />
                  Send as Message
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleShare('copy')}>
                  <Link2 className="w-4 h-4 mr-2" />
                  {copied ? "Copied!" : "Copy Link"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>
      </DialogContent>
    </Dialog>
  );
}

import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { Phone, Clock, CheckCircle, Quote } from 'lucide-react';
import Footer from '@/components/Footer';
import { useDemoAuth } from '@/contexts/DemoAuthContext';
import { useCallBackendAuth } from '@/contexts/CallBackendAuthContext';
import { supabase } from '@/integrations/supabase/client';
import userStory1 from '@/assets/user-story-1.jpg';
import userStory2 from '@/assets/user-story-2.jpg';
import userStory3 from '@/assets/user-story-3.jpg';
const Landing = () => {
  const navigate = useNavigate();
  const { isAuthenticated, signOut } = useDemoAuth();
  const { signOutCallBackend } = useCallBackendAuth();
  const handleEnter = () => {
    navigate('/dashboard');
  };
  const handleLogoClick = () => {
    navigate('/');
  };
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    signOutCallBackend();
    signOut();
    navigate('/');
  };
  const trustedLogos = ['Amazon', 'Walmart', 'Chase', 'Verizon', 'Instacart', 'Target', 'Amazon', 'Walmart', 'Chase', 'Verizon', 'Instacart', 'Target'];
  return <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Subtle Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5"></div>
      
      {/* Header */}
      <header className="relative z-10 container max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="cursor-pointer flex-row flex items-center justify-center" onClick={handleLogoClick}>
            <img alt="Holdless logo" className="w-14 h-14 object-contain object-right" src="/lovable-uploads/e1e7522b-4147-4d9f-bbb5-1b04bc489348.png" />
            <span className="text-xl font-bold tracking-tight text-sidebar-foreground -ml-2">Holdless</span>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? <>
                <Button onClick={handleEnter} variant="ghost" className="text-muted-foreground hover:text-foreground">
                  Dashboard
                </Button>
                <Button onClick={handleSignOut} className="px-6 bg-[hsl(250_60%_55%)] text-white hover:bg-[hsl(250_60%_50%)] rounded-full">
                  Sign Out
                </Button>
              </> : <Button onClick={() => navigate('/auth')} className="px-6 bg-[hsl(250_60%_55%)] text-white hover:bg-[hsl(250_60%_50%)] rounded-full">
                Join or Login
              </Button>}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 container max-w-7xl mx-auto px-4 pt-20 pb-32">
        <div className="text-center space-y-12">
          <div className="space-y-8 max-w-4xl mx-auto">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
              <span className="text-foreground">Never wait </span>
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                on hold
              </span>
              <span className="text-foreground"> again</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Your AI assistant handles customer support calls while you focus on what matters. 
              No more phone trees, no more waiting.
            </p>
            
            <div className="flex items-center justify-center gap-4 pt-4">
              {isAuthenticated ? <Button size="lg" onClick={handleEnter} className="px-8 py-6 text-base bg-[hsl(250_60%_55%)] text-white hover:bg-[hsl(250_60%_50%)] rounded-full shadow-lg">
                  Enter Dashboard
                </Button> : <Button size="lg" onClick={() => navigate('/auth')} className="px-8 py-6 text-base bg-[hsl(250_60%_55%)] text-white hover:bg-[hsl(250_60%_50%)] rounded-full shadow-lg">
                  Get Started Free
                </Button>}
            </div>
          </div>

          {/* Visual Demo */}
          <div className="relative max-w-3xl mx-auto mt-20">
            <div className="relative bg-card rounded-2xl p-6 md:p-8 shadow-xl border border-border/60">
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
                  <span className="text-sm text-muted-foreground font-medium">Calling Amazon Support...</span>
                </div>
                <div className="bg-muted/50 rounded-xl p-5 border-l-4 border-primary">
                  <p className="text-sm md:text-base text-foreground leading-relaxed">
                    "Hi, I'm calling as Sarah's authorized assistant regarding order #113-1234567. 
                    We need to request a refund for damaged strawberries."
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>On hold: 0:00 (no wait time!)</span>
                  <div className="flex gap-1 ml-auto">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                    animationDelay: '0.1s'
                  }}></div>
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{
                    animationDelay: '0.2s'
                  }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sections */}
      <div className="relative z-10">
        {/* How It Works Section - Clean Card Layout */}
        <section className="relative py-24 bg-muted/30">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center space-y-4 mb-16">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
                How Holdless Works
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                From Setup To Resolution, We've Streamlined Every Step Of Customer Support Interactions.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40">
                <h3 className="text-xl font-bold text-foreground mb-4">Create Your Task</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Tell us what you need help with in plain English. Whether it's a refund request, 
                  account issue, or product inquiry, just describe your situation.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Natural language input - no forms to fill</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Attach relevant order numbers and details</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Set priority and preferred outcome</span>
                  </li>
                </ul>
              </div>

              {/* Card 2 */}
              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40">
                <h3 className="text-xl font-bold text-foreground mb-4">AI Takes Over</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Your AI assistant calls the company on your behalf, navigates phone trees, waits 
                  on hold, and speaks with representatives using your authorized instructions.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Handles all wait times automatically</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Follows your instructions precisely</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Real-time progress updates in dashboard</span>
                  </li>
                </ul>
              </div>

              {/* Card 3 */}
              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40">
                <h3 className="text-xl font-bold text-foreground mb-4">Get Results</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                  Review complete call transcripts, confirmation numbers, and outcomes. 
                  Every interaction is documented with full transparency and proof of resolution.
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Full call transcripts and recordings</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Confirmation numbers and receipts</span>
                  </li>
                  <li className="flex items-start gap-3 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                    <span>Track time and money saved</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* User Stories Section */}
        <section className="relative py-24">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center space-y-4 mb-16">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
                Real People, Real Results
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                See how Holdless is helping people reclaim their time
              </p>
            </div>

            <div className="space-y-16">
              {/* Story 1 - Image Left */}
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div className="relative">
                  <div className="aspect-[4/3] rounded-3xl overflow-hidden">
                    <img src={userStory1} alt="Sarah M." className="w-full h-full object-cover" />
                  </div>
                </div>
                <div className="space-y-6">
                  <Quote className="w-10 h-10 text-primary/30" />
                  <p className="text-xl md:text-2xl text-foreground leading-relaxed">
                    I used to spend hours on hold with my internet provider. Now I just describe the issue 
                    and Holdless handles everything. Last month I saved over 4 hours.
                  </p>
                  <div>
                    <p className="font-semibold text-foreground">Sarah M.</p>
                    <p className="text-sm text-muted-foreground">Small Business Owner, Austin</p>
                  </div>
                </div>
              </div>

              {/* Story 2 - Image Right */}
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div className="space-y-6 md:order-1">
                  <Quote className="w-10 h-10 text-primary/30" />
                  <p className="text-xl md:text-2xl text-foreground leading-relaxed">
                    The AI got me a $280 refund from a cancelled flight that I'd given up on. 
                    The whole process took 10 minutes of my time instead of 3 hours.
                  </p>
                  <div>
                    <p className="font-semibold text-foreground">Michael T.</p>
                    <p className="text-sm text-muted-foreground">Software Engineer, Seattle</p>
                  </div>
                </div>
                <div className="relative md:order-2">
                  <div className="aspect-[4/3] rounded-3xl overflow-hidden">
                    <img src={userStory2} alt="Michael T." className="w-full h-full object-cover" />
                  </div>
                </div>
              </div>

              {/* Story 3 - Image Left */}
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div className="relative">
                  <div className="aspect-[4/3] rounded-3xl overflow-hidden">
                    <img src={userStory3} alt="Elena R." className="w-full h-full object-cover" />
                  </div>
                </div>
                <div className="space-y-6">
                  <Quote className="w-10 h-10 text-primary/30" />
                  <p className="text-xl md:text-2xl text-foreground leading-relaxed">
                    As a busy mom, I don't have time to wait on hold. Holdless disputed a wrong charge 
                    on my credit card while I was at my kid's soccer game. Problem solved.
                  </p>
                  <div>
                    <p className="font-semibold text-foreground">Elena R.</p>
                    <p className="text-sm text-muted-foreground">Marketing Manager, Chicago</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="relative py-24 bg-muted/30">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center space-y-4 mb-16">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
                Why People Love Holdless
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Join thousands who have reclaimed their time
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div className="text-center space-y-2">
                <div className="text-4xl md:text-5xl font-bold text-foreground">
                  47hrs
                </div>
                <div className="text-sm text-muted-foreground">
                  Saved per user annually
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-4xl md:text-5xl font-bold text-foreground">
                  94%
                </div>
                <div className="text-sm text-muted-foreground">
                  First attempt success
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-4xl md:text-5xl font-bold text-foreground">
                  $380
                </div>
                <div className="text-sm text-muted-foreground">
                  Average value recovered
                </div>
              </div>
              <div className="text-center space-y-2">
                <div className="text-4xl md:text-5xl font-bold text-foreground">
                  24/7
                </div>
                <div className="text-sm text-muted-foreground">
                  AI availability
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Use Cases Section */}
        <section className="relative py-24">
          <div className="container max-w-7xl mx-auto px-4">
            <div className="text-center space-y-4 mb-16">
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
                Perfect For Any Support Need
              </h2>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40 hover:border-border/60 transition-colors">
                <h3 className="text-lg font-semibold text-foreground mb-3">E-Commerce Issues</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  Handle returns, refunds, damaged items, and delivery problems across all your favorite retailers.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Amazon</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Walmart</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Target</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Instacart</span>
                </div>
              </div>

              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40 hover:border-border/60 transition-colors">
                <h3 className="text-lg font-semibold text-foreground mb-3">Subscription Management</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  Cancel unwanted subscriptions, resolve billing disputes, and update payment information effortlessly.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Streaming</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Software</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Memberships</span>
                </div>
              </div>

              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40 hover:border-border/60 transition-colors">
                <h3 className="text-lg font-semibold text-foreground mb-3">Utilities & Services</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  Manage internet, phone, and utility accounts. Resolve service issues and negotiate better rates.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Verizon</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">AT&T</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Comcast</span>
                </div>
              </div>

              <div className="bg-card rounded-2xl p-8 shadow-sm border border-border/40 hover:border-border/60 transition-colors">
                <h3 className="text-lg font-semibold text-foreground mb-3">Financial Services</h3>
                <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                  Dispute charges, request fee waivers, and handle account inquiries with banks and credit card companies.
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Chase</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Bank of America</span>
                  <span className="text-xs px-3 py-1.5 bg-muted text-muted-foreground rounded-full">Amex</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trusted By Section - Scrolling at bottom */}
        <section className="relative py-16 bg-muted/20 overflow-hidden">
          <div className="text-center mb-8">
            <p className="text-sm font-medium text-muted-foreground tracking-wider uppercase">
              Trusted By
            </p>
          </div>
          <div className="relative">
            <div className="flex animate-scroll-left">
              {trustedLogos.map((logo, index) => <div key={index} className="flex-shrink-0 mx-12 text-muted-foreground/60 font-semibold text-xl">
                  {logo}
                </div>)}
            </div>
          </div>
        </section>

        {/* Video Section */}
        <section className="relative py-24 bg-background">
          <div className="container max-w-5xl mx-auto px-4">
            <div className="text-center space-y-4 mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-foreground tracking-tight">
                See Holdless in Action
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Watch how our AI handles customer service calls for you
              </p>
            </div>
            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl border border-border/40">
              <iframe className="absolute inset-0 w-full h-full" src="https://www.youtube.com/embed/H1F35_bPaII" title="Holdless Demo Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>
        </section>
        
        <Footer />
      </div>
    </div>;
};
export default Landing;
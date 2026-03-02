import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Terms = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <div className="mb-6">
          <Button 
            variant="outline" 
            onClick={() => navigate('/')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Button>
        </div>
        <div className="space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-foreground">Terms of Service</h1>
            <p className="text-muted-foreground">Last updated: September 16, 2025</p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              These Terms of Service govern your use of Holdless, an AI-powered assistant service 
              that handles customer service calls on your behalf.
            </p>
          </div>

          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Service Description</h2>
              <p className="text-muted-foreground leading-relaxed">
                Holdless provides AI-powered assistance for customer service interactions, including 
                but not limited to handling phone calls, navigating automated systems, and 
                communicating with representatives on your behalf.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">User Responsibilities</h2>
              <p className="text-muted-foreground leading-relaxed">
                You are responsible for providing accurate information for service requests and 
                ensuring you have the authority to authorize our service to act on your behalf 
                with third-party vendors.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Recording Consent</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our service may record calls for quality assurance and training purposes. 
                Recording is optional and can be disabled in your account settings. When enabled, 
                we comply with all applicable recording consent laws.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Third-Party Vendors</h2>
              <p className="text-muted-foreground leading-relaxed">
                We interact with various third-party customer service departments on your behalf. 
                We are not responsible for the policies, procedures, or decisions of these 
                third-party organizations.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our service is provided "as is" and we make no guarantees about specific outcomes 
                from customer service interactions. We are not liable for any damages resulting 
                from the use of our service.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terms;
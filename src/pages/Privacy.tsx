import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Privacy = () => {
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
            <h1 className="text-4xl font-bold text-foreground">Privacy Policy</h1>
            <p className="text-muted-foreground">Last updated: September 16, 2025</p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              This Privacy Policy describes how Holdless collects, uses, and protects your 
              personal information when you use our AI assistant service.
            </p>
          </div>

          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Data Collection</h2>
              <p className="text-muted-foreground leading-relaxed">
                We collect only the minimum personal information necessary to provide our service, 
                including your name, contact information, and details about your customer service 
                requests. We may also collect conversation transcripts and call recordings when enabled.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Data Use</h2>
              <p className="text-muted-foreground leading-relaxed">
                Your personal information is used solely to provide customer service assistance 
                on your behalf. We do not sell, rent, or share your personal information with 
                third parties except as necessary to complete your service requests.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement industry-standard security measures to protect your personal information, 
                including encryption at rest and in transit. Sensitive information like verification 
                codes and authentication details are encrypted using field-level encryption.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your personal information only as long as necessary to provide our services 
                or as required by law. You can configure data retention settings in your account, 
                including automatic deletion of transcripts and recordings after specified periods.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold text-foreground">Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                You have the right to access, update, or delete your personal information at any time. 
                You can also control what information is shared with specific vendors and disable 
                call recording through your account settings.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Privacy;
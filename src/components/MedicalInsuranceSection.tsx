import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  CreditCard,
  Building2,
  Phone,
  Upload,
  X,
  Loader2,
  HeartPulse,
  Mail,
  MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  TASK_ATTACHMENT_BUCKET,
  uploadTaskAttachments,
  validateTaskAttachment,
} from "@/lib/taskAttachments";
import { extractBillFields, type ExtractedBillFields } from "@/lib/chatApi";
import type { UserProfile } from "@/hooks/useUserProfile";
import {
  getMissingMedicalInsuranceLabels,
  hasCompleteMedicalInsurance,
  hasPartialMedicalInsurance,
  isMedicalInsuranceFieldMissing,
  type MedicalInsuranceFieldKey,
} from "@/lib/medicalInsuranceProfile";

function normalizeDateForInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return trimmed;
}

function applyInsuranceExtraction(
  extracted: ExtractedBillFields,
): Partial<UserProfile> {
  const updates: Partial<UserProfile> = {};
  if (extracted.memberName?.trim()) {
    updates.insuranceMemberName = extracted.memberName.trim();
  }
  if (extracted.memberId?.trim()) {
    updates.insuranceMemberId = extracted.memberId.trim();
  }
  if (extracted.dateOfBirth?.trim()) {
    updates.insuranceDateOfBirth = normalizeDateForInput(extracted.dateOfBirth);
  }
  if (extracted.insuranceCompanyName?.trim()) {
    updates.insuranceCompanyName = extracted.insuranceCompanyName.trim();
  }
  if (extracted.insurancePhoneNumber?.trim()) {
    updates.insurancePhoneNumber = extracted.insurancePhoneNumber.trim();
  }
  if (extracted.memberEmail?.trim()) {
    updates.insuranceEmail = extracted.memberEmail.trim();
  }
  if (extracted.memberAddress?.trim()) {
    updates.insuranceAddress = extracted.memberAddress.trim();
  }
  return updates;
}

interface MedicalInsuranceSectionProps {
  profile: Pick<
    UserProfile,
    | "insuranceMemberName"
    | "insuranceDateOfBirth"
    | "insuranceMemberId"
    | "insuranceCompanyName"
    | "insurancePhoneNumber"
    | "insuranceEmail"
    | "insuranceAddress"
    | "insuranceCardImagePath"
  >;
  onUpdateProfile: (field: string, value: string) => void;
  onUpdateMultiple?: (updates: Partial<UserProfile>) => void;
  userId: string | null;
}

export function MedicalInsuranceSection({
  profile,
  onUpdateProfile,
  onUpdateMultiple,
  userId,
}: MedicalInsuranceSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cardPreviewUrl, setCardPreviewUrl] = useState<string | null>(null);

  const loadPreview = useCallback(async (path: string) => {
    if (!path) {
      setCardPreviewUrl(null);
      return;
    }
    const { data } = await supabase.storage
      .from(TASK_ATTACHMENT_BUCKET)
      .createSignedUrl(path, 60 * 60);
    setCardPreviewUrl(data?.signedUrl ?? null);
  }, []);

  useEffect(() => {
    loadPreview(profile.insuranceCardImagePath);
  }, [profile.insuranceCardImagePath, loadPreview]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;

    const file = files[0];
    const validationError = validateTaskAttachment(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    if (!userId) {
      setUploadError("Please sign in to upload your insurance card.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const attachments = await uploadTaskAttachments(userId, [file]);
      const extracted = await extractBillFields(
        userId,
        attachments as unknown as Array<Record<string, unknown>>,
      );
      const path = attachments[0]?.path ?? "";
      if (path) {
        onUpdateProfile("insuranceCardImagePath", path);
      }
      if (extracted && onUpdateMultiple) {
        const updates = applyInsuranceExtraction(extracted);
        if (Object.keys(updates).length > 0) {
          onUpdateMultiple(updates);
        }
      } else if (extracted) {
        const updates = applyInsuranceExtraction(extracted);
        for (const [key, value] of Object.entries(updates)) {
          if (typeof value === "string") {
            onUpdateProfile(key, value);
          }
        }
      }
      if (path) {
        await loadPreview(path);
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to process insurance card.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveCard = () => {
    onUpdateProfile("insuranceCardImagePath", "");
    setCardPreviewUrl(null);
    setUploadError(null);
  };

  const isComplete = hasCompleteMedicalInsurance(profile);
  const isPartial = hasPartialMedicalInsurance(profile);
  const missingLabels = getMissingMedicalInsuranceLabels(profile);
  const showFieldErrors = isPartial;

  const requiredMark = (
    <span className="text-destructive ml-0.5" aria-hidden>
      *
    </span>
  );

  const fieldErrorClass = (key: MedicalInsuranceFieldKey) =>
    showFieldErrors && isMedicalInsuranceFieldMissing(profile, key)
      ? "border-destructive/70 focus:border-destructive"
      : "border-border/60 focus:border-primary/50";

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="w-5 h-5" />
          Medical Insurance
        </CardTitle>
        <p className="text-sm text-muted-foreground font-normal mt-1">
          All fields are required to save and use your medical insurance profile
          for calls and autofill. Holdless chat works without this section.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {isPartial && (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <p className="font-medium">Complete your medical insurance profile</p>
            <p className="mt-1 text-amber-800/90">
              You&apos;ve started filling this section, but it can&apos;t be used
              until every required field is complete. Please fill in:
            </p>
            <ul className="mt-2 list-disc list-inside space-y-0.5 text-amber-800/90">
              {missingLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-3">
          <Label className="text-sm font-medium text-foreground">
            Insurance card image
            {requiredMark}
          </Label>
          {cardPreviewUrl ? (
            <div className="relative rounded-lg border border-border/60 overflow-hidden bg-muted/30">
              <img
                src={cardPreviewUrl}
                alt="Uploaded insurance card"
                className="w-full max-h-64 object-contain"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute top-2 right-2 h-8 w-8 p-0"
                onClick={handleRemoveCard}
                aria-label="Remove insurance card image"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <label
              htmlFor="insurance-card-upload"
              className={`flex flex-col items-center justify-center w-full min-h-[8rem] border-2 border-dashed rounded-lg cursor-pointer bg-muted/30 hover:bg-muted/50 transition-colors ${
                showFieldErrors &&
                isMedicalInsuranceFieldMissing(profile, "insuranceCardImagePath")
                  ? "border-destructive/60"
                  : "border-border"
              } ${uploading ? "pointer-events-none opacity-70" : ""}`}
            >
              <div className="flex flex-col items-center justify-center py-6 px-4">
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-muted-foreground mb-2 animate-spin" />
                ) : (
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                )}
                <p className="text-sm text-muted-foreground text-center">
                  <span className="font-medium text-primary">
                    {uploading ? "Extracting details…" : "Click to upload"}
                  </span>
                  {!uploading && " or drag and drop"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  PNG, JPG, or PDF up to 10MB
                </p>
              </div>
            </label>
          )}
          <input
            ref={fileInputRef}
            id="insurance-card-upload"
            type="file"
            className="hidden"
            accept="image/*,.pdf"
            disabled={uploading}
            onChange={handleFileSelect}
          />
          {cardPreviewUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Replace image
            </Button>
          )}
          {!userId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Sign in to upload and auto-fill from your insurance card. You can
              still enter details manually.
            </p>
          )}
          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/50">
          <div className="space-y-2 md:col-span-2">
            <Label
              htmlFor="insuranceMemberName"
              className="text-sm font-medium text-foreground"
            >
              Name on insurance card
              {requiredMark}
            </Label>
            <Input
              id="insuranceMemberName"
              value={profile.insuranceMemberName}
              onChange={(e) =>
                onUpdateProfile("insuranceMemberName", e.target.value)
              }
              placeholder="e.g. Liying Chen"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceMemberName")}`}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="insuranceDateOfBirth"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <Calendar className="w-4 h-4 text-muted-foreground" />
              Date of birth (on card)
              {requiredMark}
            </Label>
            <Input
              id="insuranceDateOfBirth"
              type="date"
              value={profile.insuranceDateOfBirth}
              onChange={(e) =>
                onUpdateProfile("insuranceDateOfBirth", e.target.value)
              }
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceDateOfBirth")}`}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="insuranceMemberId"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              Member ID
              {requiredMark}
            </Label>
            <Input
              id="insuranceMemberId"
              value={profile.insuranceMemberId}
              onChange={(e) =>
                onUpdateProfile("insuranceMemberId", e.target.value)
              }
              placeholder="e.g. 821896741"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceMemberId")}`}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="insuranceCompanyName"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <Building2 className="w-4 h-4 text-muted-foreground" />
              Medical institution / insurer
              {requiredMark}
            </Label>
            <Input
              id="insuranceCompanyName"
              value={profile.insuranceCompanyName}
              onChange={(e) =>
                onUpdateProfile("insuranceCompanyName", e.target.value)
              }
              placeholder="e.g. Aetna / WellAway"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceCompanyName")}`}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="insurancePhoneNumber"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <Phone className="w-4 h-4 text-muted-foreground" />
              Institution phone number
              {requiredMark}
            </Label>
            <Input
              id="insurancePhoneNumber"
              type="tel"
              value={profile.insurancePhoneNumber}
              onChange={(e) =>
                onUpdateProfile("insurancePhoneNumber", e.target.value)
              }
              placeholder="e.g. +1-855-773-7810"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insurancePhoneNumber")}`}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="insuranceEmail"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <Mail className="w-4 h-4 text-muted-foreground" />
              Email (on insurance account)
              {requiredMark}
            </Label>
            <Input
              id="insuranceEmail"
              type="email"
              value={profile.insuranceEmail}
              onChange={(e) =>
                onUpdateProfile("insuranceEmail", e.target.value)
              }
              placeholder="e.g. member@example.com"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceEmail")}`}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label
              htmlFor="insuranceAddress"
              className="text-sm font-medium text-foreground flex items-center gap-2"
            >
              <MapPin className="w-4 h-4 text-muted-foreground" />
              Address (on insurance account)
              {requiredMark}
            </Label>
            <Input
              id="insuranceAddress"
              value={profile.insuranceAddress}
              onChange={(e) =>
                onUpdateProfile("insuranceAddress", e.target.value)
              }
              placeholder="e.g. 123 Main St, Los Angeles, CA 90007"
              required
              className={`h-11 transition-colors ${fieldErrorClass("insuranceAddress")}`}
            />
          </div>
        </div>

        {isComplete && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            Medical insurance profile is complete and ready to use for calls and
            autofill.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

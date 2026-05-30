import type { UserProfile } from "@/hooks/useUserProfile";

export type MedicalInsuranceFieldKey =
  | "insuranceCardImagePath"
  | "insuranceMemberName"
  | "insuranceDateOfBirth"
  | "insuranceMemberId"
  | "insuranceCompanyName"
  | "insurancePhoneNumber"
  | "insuranceEmail"
  | "insuranceAddress";

export const MEDICAL_INSURANCE_REQUIRED_FIELDS: ReadonlyArray<{
  key: MedicalInsuranceFieldKey;
  label: string;
}> = [
  { key: "insuranceCardImagePath", label: "Insurance card image" },
  { key: "insuranceMemberName", label: "Name on insurance card" },
  { key: "insuranceDateOfBirth", label: "Date of birth (on card)" },
  { key: "insuranceMemberId", label: "Member ID" },
  { key: "insuranceCompanyName", label: "Medical institution / insurer" },
  { key: "insurancePhoneNumber", label: "Institution phone number" },
  { key: "insuranceEmail", label: "Email (on insurance account)" },
  { key: "insuranceAddress", label: "Address (on insurance account)" },
] as const;

export type MedicalInsuranceProfileSlice = Pick<
  UserProfile,
  MedicalInsuranceFieldKey
>;

function fieldFilled(profile: MedicalInsuranceProfileSlice, key: MedicalInsuranceFieldKey): boolean {
  return Boolean(String(profile[key] ?? "").trim());
}

export function getMissingMedicalInsuranceFields(
  profile: MedicalInsuranceProfileSlice,
): MedicalInsuranceFieldKey[] {
  return MEDICAL_INSURANCE_REQUIRED_FIELDS.filter(
    ({ key }) => !fieldFilled(profile, key),
  ).map(({ key }) => key);
}

export function getMissingMedicalInsuranceLabels(
  profile: MedicalInsuranceProfileSlice,
): string[] {
  const missing = new Set(getMissingMedicalInsuranceFields(profile));
  return MEDICAL_INSURANCE_REQUIRED_FIELDS.filter(({ key }) => missing.has(key)).map(
    ({ label }) => label,
  );
}

export function hasCompleteMedicalInsurance(
  profile: MedicalInsuranceProfileSlice,
): boolean {
  return getMissingMedicalInsuranceFields(profile).length === 0;
}

/** Any medical insurance field filled, but not all required fields. */
export function hasPartialMedicalInsurance(
  profile: MedicalInsuranceProfileSlice,
): boolean {
  const anyFilled = MEDICAL_INSURANCE_REQUIRED_FIELDS.some(({ key }) =>
    fieldFilled(profile, key),
  );
  return anyFilled && !hasCompleteMedicalInsurance(profile);
}

export function isMedicalInsuranceFieldMissing(
  profile: MedicalInsuranceProfileSlice,
  key: MedicalInsuranceFieldKey,
): boolean {
  return !fieldFilled(profile, key);
}

export const TERMS_VERSION = "1.0";
export const PRIVACY_VERSION = "1.0";

export type LegalConsent = {
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
};

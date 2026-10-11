export const TERMS_VERSION = "1.1";
export const PRIVACY_VERSION = "1.1";

export type LegalConsent = {
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
};

export const TERMS_VERSION = "1.2";
export const PRIVACY_VERSION = "1.2";

export type LegalConsent = {
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
};

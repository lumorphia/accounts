import text from "../../../../docs/legal/privacy.md?raw";
import { LegalDocument } from "../components/legal-document.tsx";
export function meta() {
  return [{ title: "プライバシーポリシー - Lumorphia" }];
}
export default function Privacy() {
  return <LegalDocument text={text} />;
}

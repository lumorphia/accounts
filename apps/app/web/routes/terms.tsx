import text from "../../../../docs/legal/terms.md?raw";
import { LegalDocument } from "../components/legal-document.tsx";
export function meta() {
  return [{ title: "利用規約 - Lumorphia" }];
}
export default function Terms() {
  return <LegalDocument text={text} />;
}

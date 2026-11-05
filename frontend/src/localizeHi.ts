import type { ErrorObject } from "ajv";

const types: Record<string, string> = {
  string: "पाठ",
  number: "संख्या",
  integer: "पूर्णांक",
  boolean: "बूलियन मान",
  object: "ऑब्जेक्ट",
  array: "सूची",
};

export default function localizeHi(errors?: null | ErrorObject[]): void {
  if (!errors) return;
  for (const error of errors) {
    const params = error.params as Record<string, unknown>;
    const limit = String(params.limit ?? "");
    switch (error.keyword) {
      case "required":
        error.message = "यह फ़ील्ड आवश्यक है";
        break;
      case "type":
        error.message = `मान ${types[String(params.type)] ?? String(params.type)} होना चाहिए`;
        break;
      case "format":
        error.message = `मान्य ${String(params.format)} होना चाहिए`;
        break;
      case "minLength":
        error.message = `कम से कम ${limit} अक्षर दर्ज करें`;
        break;
      case "maxLength":
        error.message = `अधिकतम ${limit} अक्षर दर्ज करें`;
        break;
      case "minimum":
        error.message = `मान ${limit} या उससे अधिक होना चाहिए`;
        break;
      case "maximum":
        error.message = `मान ${limit} या उससे कम होना चाहिए`;
        break;
      case "exclusiveMinimum":
        error.message = `मान ${limit} से अधिक होना चाहिए`;
        break;
      case "exclusiveMaximum":
        error.message = `मान ${limit} से कम होना चाहिए`;
        break;
      case "minItems":
        error.message = `कम से कम ${limit} आइटम जोड़ें`;
        break;
      case "maxItems":
        error.message = `अधिकतम ${limit} आइटम जोड़ें`;
        break;
      case "enum":
        error.message = "सूची में से एक विकल्प चुनें";
        break;
      case "pattern":
        error.message = "निर्धारित प्रारूप का पालन करें";
        break;
      case "additionalProperties":
        error.message = "अतिरिक्त फ़ील्ड की अनुमति नहीं है";
        break;
      case "uniqueItems":
        error.message = "सूची के प्रत्येक आइटम का मान अलग होना चाहिए";
        break;
      default:
        error.message = "दर्ज किया गया मान मान्य नहीं है";
    }
  }
}

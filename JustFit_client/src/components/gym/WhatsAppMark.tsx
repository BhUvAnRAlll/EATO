import { Image } from "react-native";

import { images } from "@/constants/images";

// The WhatsApp mark on every WhatsApp button in the gym portal: the logo file the user supplied
// (assets/images/whatsapp-logo.png, transparent corners), never redrawn. `size` is its width and
// height in px; the file's own rounded corners show, so no border radius is needed.
export function WhatsAppMark({ size = 20 }: { size?: number }) {
  return <Image source={images.whatsappLogo} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}

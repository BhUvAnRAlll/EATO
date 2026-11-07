import { Pressable, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { GymIcon } from "@/components/gym/GymIcon";
import { WhatsAppMark } from "@/components/gym/WhatsAppMark";
import { GymSheet } from "@/components/gym/GymSheet";
import { gymApi, type ContactKind, type ContactOutcome, type GymEnquiry } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useThemeColors } from "@/theme";
import type { GymIconName } from "@/constants/gymIcons";

type Option = { label: string; icon: GymIconName | "whatsapp"; kind: ContactKind; outcome?: ContactOutcome };
// After a call the phone comes back to the app: just how it went
const AFTER_CALL: Option[] = [
  { label: "Reached them", icon: "phone", kind: "call", outcome: "reached" },
  { label: "No answer", icon: "phone-off", kind: "call", outcome: "no_answer" },
];
// Logged by hand: a call, a WhatsApp message or a visit
const ANY: Option[] = [
  ...AFTER_CALL,
  { label: "Messaged on WhatsApp, they replied", icon: "whatsapp", kind: "whatsapp", outcome: "reached" },
  { label: "Messaged on WhatsApp, no reply", icon: "whatsapp", kind: "whatsapp", outcome: "no_answer" },
  { label: "They visited the gym", icon: "store", kind: "visit" },
];

// Manage › Enquiry: log a contact attempt with an enquiry (feeds the Hot / Warm / Cold score).
// Opens by itself after Call, when the app comes back to the front (with Skip), and from the
// card's log button. One tap saves it, dated today.
export function EnquiryContactSheet({ enquiry, afterCall, onClose, onSaved }: { enquiry: GymEnquiry; afterCall: boolean; onClose: () => void; onSaved: (enquiry: GymEnquiry) => void }) {
  const colors = useThemeColors();
  const { busy, error, save } = useGymSave((data: { enquiry: GymEnquiry }) => onSaved(data.enquiry));
  const log = (option: Option) => {
    if (busy) return;
    haptic.select();
    save((token) => gymApi.addContact(token, enquiry.id, { kind: option.kind, outcome: option.outcome }));
  };
  return (
    <GymSheet title={afterCall ? "How did it go?" : "Log a contact"} subtitle={afterCall ? `Your call to ${enquiry.name}` : `With ${enquiry.name}, today`} onClose={onClose}>
      <View>
        {(afterCall ? AFTER_CALL : ANY).map((option) => (
          <Pressable key={option.label} onPress={() => log(option)} disabled={busy} className="gym-addrow" accessibilityRole="button" accessibilityLabel={option.label}>
            {option.icon === "whatsapp" ? <WhatsAppMark size={22} /> : <GymIcon name={option.icon} size={20} color={option.outcome === "no_answer" ? colors.gymDanger : colors.gymPrimary} />}
            <Text className="gym-menu__label flex-1" numberOfLines={1}>{option.label}</Text>
          </Pressable>
        ))}
        {afterCall && (
          <Pressable onPress={onClose} disabled={busy} className="gym-addrow" accessibilityRole="button" accessibilityLabel="Skip logging this call">
            <GymIcon name="x" size={20} color={colors.gymMuted} />
            <Text className="gym-menu__label flex-1" style={{ color: colors.gymMuted }}>Skip</Text>
          </Pressable>
        )}
      </View>
      {error ? <FormAlert message={error} /> : null}
    </GymSheet>
  );
}

import { useCallback, useState } from "react";
import { Share, Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { GymIcon } from "@/components/gym/GymIcon";
import { CatalogSheet } from "@/components/gym/CatalogSheet";
import { ConfirmDialog } from "@/components/gym/ConfirmDialog";
import { DateSelect } from "@/components/gym/DateSelect";
import { DueByField } from "@/components/gym/DueByField";
import { GradientFill } from "@/components/gym/GradientFill";
import { CheckRow, ChipRow, METHODS } from "@/components/gym/GymChoice";
import { GymField, amountInput, rupeesFromText } from "@/components/gym/GymField";
import { GymPrimaryButton } from "@/components/gym/GymPrimaryButton";
import { GymSheet } from "@/components/gym/GymSheet";
import { PlanLengthFields, durationValue } from "@/components/gym/PlanLengthFields";
import { GENDER_LABEL, METHOD_LABEL, daysFromToday, initialsOf, phoneInput, planLabel, rupees, shortDate } from "@/data/gymDashboard";
import { comingSoon } from "@/lib/gymPortal";
import { gymApi, type CatalogItem, type Gender, type GymMemberDetail, type PayMethod, type PlanUnit } from "@/lib/gymApi";
import { useGymSave } from "@/lib/gymForm";
import { haptic } from "@/lib/haptics";
import { useGymData } from "@/lib/useGymData";
import { useThemeColors } from "@/theme";

// Back (outlined) and the step's main action, side by side as in the designs
function StepButtons({ onBack, label, ready, busy, onNext }: { onBack: () => void; label: string; ready: boolean; busy?: boolean; onNext: () => void }) {
  return (
    <View className="flex-row" style={{ gap: 12, marginTop: 4 }}>
      <PressableScale onPress={onBack} className="gym-btn gym-btn--outline" style={{ paddingHorizontal: 24, marginTop: 4 }} accessibilityRole="button" accessibilityLabel="Back">
        <Text className="gym-btn__label gym-btn__label--outline">Back</Text>
      </PressableScale>
      <View className="min-w-0 flex-1">
        <GymPrimaryButton label={label} ready={ready} busy={busy} onPress={onNext} />
      </View>
    </View>
  );
}

const numberOrBlank = (text: string) => (text.trim() === "" ? "" : Number(text));

// Home › + › Add Member (the user's designs), in three steps:
//   1. the profile: the Member ID the server will give them, name, mobile, gender
//   2. optional fields: email, height, weight, address, notes, date of birth (attachments later)
//   3. the plan and payment: joining and payment dates, a plan from the catalogue (or a custom
//      one, or Add New Plan), admission amount, discount, mode, what's payable and owed, the
//      amount collected, the due date when something is owed, and Send Invoice
// then "Please confirm the details". The server makes the ID and checks every field again.
export function AddMemberSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (detail: GymMemberDetail) => void }) {
  const colors = useThemeColors();
  const loadCode = useCallback((token: string | null) => gymApi.nextCode(token), []);
  const { result: code } = useGymData(loadCode);
  const loadCatalog = useCallback((token: string | null) => gymApi.catalog(token), []);
  const { result: catalog, set: setCatalog } = useGymData(loadCatalog);
  const plans = catalog.state === "ready" ? catalog.data.items.filter((i) => i.kind === "plan") : [];

  const [step, setStep] = useState<1 | 2 | 3>(1);
  // Step 1
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  // Step 2
  const [email, setEmail] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [dob, setDob] = useState<string | null>(null);
  // Step 3
  const [joinedOn, setJoinedOn] = useState(daysFromToday(0));
  const [paidOn, setPaidOn] = useState(daysFromToday(0));
  const [planId, setPlanId] = useState<number | "custom" | null>(null);
  const [unit, setUnit] = useState<PlanUnit>("months");
  const [duration, setDuration] = useState("1");
  const [customFee, setCustomFee] = useState("");
  const [admission, setAdmission] = useState("");
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<PayMethod | "">("online");
  const [collected, setCollected] = useState("");
  const [dueBy, setDueBy] = useState<string | null>(daysFromToday(7));
  const [sendInvoice, setSendInvoice] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const share = (detail: GymMemberDetail) => {
    const m = detail.member;
    const lines = [
      `${m.name} (${m.code})`,
      `Plan: ${planLabel(m.planLength.duration, m.planLength.unit)}, until ${shortDate(m.expiresOn)}`,
      ...(detail.payments[0] ? [`Paid: ${rupees(detail.payments[0].amount)} (${METHOD_LABEL[detail.payments[0].method]}) on ${shortDate(detail.payments[0].paidOn)}`] : []),
      m.due > 0 ? `Due: ${rupees(m.due)}${m.dueBy ? ` by ${shortDate(m.dueBy)}` : ""}` : "Paid in full",
    ];
    Share.share({ message: `Membership receipt\n${lines.join("\n")}` }).catch(() => {});
  };
  const { busy, error, save } = useGymSave((detail: GymMemberDetail) => {
    if (sendInvoice) share(detail);
    onSaved(detail);
  });

  // Step 1
  const phoneOk = phone.length === 0 || /^[6-9]\d{9}$/.test(phone);
  const profileReady = name.trim().length >= 2 && phoneOk;
  // Step 2
  const emailOk = email.trim() === "" || /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(email.trim());
  const heightNum = numberOrBlank(height);
  const weightNum = numberOrBlank(weight);
  const heightOk = heightNum === "" || (Number.isInteger(heightNum) && heightNum >= 50 && heightNum <= 250);
  const weightOk = weightNum === "" || (Number.isFinite(weightNum) && weightNum >= 10 && weightNum <= 300);
  const detailsReady = emailOk && heightOk && weightOk;
  // Step 3: the plan's length and price come from the chosen catalogue plan, or are typed
  const chosen: CatalogItem | undefined = typeof planId === "number" ? plans.find((p) => p.id === planId) : undefined;
  const length = chosen?.duration && chosen.unit ? chosen.duration : durationValue(duration, unit);
  const lengthUnit: PlanUnit = chosen?.unit ?? unit;
  const planFee = chosen ? chosen.price : rupeesFromText(customFee);
  const admissionNum = admission.trim() === "" ? 0 : rupeesFromText(admission);
  const discountNum = discount.trim() === "" ? 0 : rupeesFromText(discount);
  const payable = Number.isNaN(planFee) ? 0 : Math.max(0, planFee + admissionNum - discountNum);
  const paidNum = rupeesFromText(collected);
  const due = Number.isNaN(paidNum) ? payable : Math.max(0, payable - paidNum);
  const planChosen = planId !== null && length !== null && planFee >= 1;
  const amountsOk = planChosen && discountNum <= planFee + admissionNum && payable >= 1 && paidNum >= 1 && paidNum <= payable && method !== "";
  const payReady = amountsOk && (due === 0 || dueBy !== null);

  const submit = () => {
    setConfirming(false);
    save((token) =>
      gymApi.admit(token, {
        name: name.trim(), phone, dob: dob ?? "", gender,
        email: email.trim(), heightCm: heightNum === "" ? "" : heightNum, weightKg: weightNum === "" ? "" : weightNum, address: address.trim(), notes: notes.trim(),
        unit: lengthUnit, duration: length ?? 1, fee: planFee, admissionFee: admissionNum, discount: discountNum, paid: paidNum, method: method || "online",
        dueBy: due > 0 && dueBy ? dueBy : "", joinedOn, paidOn,
      }),
    );
  };
  const rows: [string, string][] = [
    ["Name", name.trim()],
    ["Plan", `${planLabel(length ?? 1, lengthUnit)} from ${shortDate(joinedOn)}`],
    ["Payable", rupees(payable)],
    ["Collected", `${rupees(Number.isNaN(paidNum) ? 0 : paidNum)} · ${METHODS[method || "online"]}`],
    ...(due > 0 ? [["Due", `${rupees(due)}${dueBy ? ` by ${shortDate(dueBy)}` : ""}`] as [string, string]] : []),
  ];

  return (
    <>
      <GymSheet
        title="Add New Member"
        subtitle="Add member profile."
        onClose={onClose}
        overlay={confirming ? <ConfirmDialog rows={rows} onEdit={() => setConfirming(false)} onConfirm={submit} /> : null}
      >
        {step === 1 && (
          <>
            <View className="gym-member-photo self-center" accessible accessibilityLabel="Member photo">
              {name.trim() ? <Text className="gym-member-photo__initials">{initialsOf(name)}</Text> : <GymIcon name="user" size={44} color={colors.white} />}
            </View>
            <View style={{ gap: 6 }}>
              <GymField label="Member ID" icon="id-card" value={code.state === "ready" ? code.data.code : ""} placeholder="Member ID" editable={false} />
              {code.state === "ready" && (
                <View className="flex-row items-center" style={{ gap: 6, paddingLeft: 6 }}>
                  <GymIcon name="badge-check" size={16} color={colors.gymSuccess} />
                  <Text className="gym-tx__meta" style={{ color: colors.gymInkSoft }}>Member ID assigned automatically</Text>
                </View>
              )}
            </View>
            <GymField label="Name" icon="user" value={name} onChangeText={setName} maxLength={80} placeholder="Name" autoCapitalize="words" />
            <View className="flex-row items-start" style={{ gap: 10 }}>
              <View className="gym-field--icon" style={{ paddingHorizontal: 14 }} accessible accessibilityLabel="India, plus 91">
                <Text style={{ fontSize: 18 }}>🇮🇳</Text>
                <Text className="gym-tx__name">+91</Text>
              </View>
              <View className="min-w-0 flex-1">
                <GymField label="Mobile number" icon="phone" value={phone} onChangeText={(t) => setPhone(phoneInput(t))} maxLength={16} keyboardType="phone-pad" placeholder="Mobile Number" hint={phoneOk ? undefined : "Enter a 10-digit mobile number starting with 6, 7, 8 or 9."} />
              </View>
            </View>
            <ChipRow label="Gender" options={GENDER_LABEL} value={gender} onChange={(g) => setGender(g)} clearable />
            <GymPrimaryButton label="Proceed" ready={profileReady} onPress={() => setStep(2)} />
          </>
        )}

        {step === 2 && (
          <>
            <Text className="gym-field__label" style={{ fontSize: 15 }}>Optional fields</Text>
            <GymField label="Email" icon="mail" value={email} onChangeText={setEmail} maxLength={120} placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} hint={emailOk ? undefined : "Enter a valid email address."} />
            <View className="flex-row" style={{ gap: 10 }}>
              <View className="min-w-0 flex-1">
                <GymField label="Height in cm" icon="ruler" value={height} onChangeText={(t) => setHeight(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad" placeholder="Height (cm)" hint={heightOk ? undefined : "50 to 250 cm"} />
              </View>
              <View className="min-w-0 flex-1">
                <GymField label="Weight in kg" icon="weight" value={weight} onChangeText={(t) => setWeight(t.replace(/[^0-9.]/g, "").slice(0, 5))} keyboardType="decimal-pad" placeholder="Weight (kg)" hint={weightOk ? undefined : "10 to 300 kg"} />
              </View>
            </View>
            <GymField label="Address" icon="map-pin" value={address} onChangeText={setAddress} maxLength={200} placeholder="Address" />
            <GymField label="Notes" icon="notebook-pen" value={notes} onChangeText={setNotes} maxLength={300} placeholder="Notes" />
            <DateSelect label="Date of Birth" value={dob} onChange={setDob} min="1920-01-01" max={daysFromToday(0)} />
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <Text className="gym-field__label" style={{ fontSize: 14 }}>Attachment</Text>
              <PressableScale onPress={() => comingSoon("Attachments")} className="gym-choice flex-row items-center" style={{ gap: 8 }} accessibilityRole="button" accessibilityLabel="Attachment, coming soon">
                <GymIcon name="image" size={16} color={colors.gymPrimary} />
                <Text className="gym-choice__label">Select</Text>
              </PressableScale>
            </View>
            <StepButtons onBack={() => setStep(1)} label="Proceed" ready={detailsReady} onNext={() => setStep(3)} />
          </>
        )}

        {step === 3 && (
          <>
            <View className="flex-row" style={{ gap: 16 }}>
              <View className="min-w-0 flex-1"><DateSelect label="Joining Date" value={joinedOn} onChange={setJoinedOn} min={daysFromToday(-365)} max={daysFromToday(60)} stacked /></View>
              <View className="min-w-0 flex-1"><DateSelect label="Payment Date" value={paidOn} onChange={setPaidOn} min={daysFromToday(-365)} max={daysFromToday(0)} stacked /></View>
            </View>
            <Text className="gym-field__label" style={{ fontSize: 14 }}>{`Available Plans (${plans.length})`}</Text>
            <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
              {plans.map((p) => {
                const selected = p.id === planId;
                return (
                  <PressableScale key={p.id} onPress={() => { haptic.select(); setPlanId(p.id); }} className={selected ? "gym-kind gym-kind--selected" : "gym-kind"} style={{ minHeight: 36, paddingHorizontal: 14 }} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${p.name}, ${rupees(p.price)}`}>
                    {selected && <GradientFill radius={999} />}
                    <Text className={selected ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>{p.name}</Text>
                  </PressableScale>
                );
              })}
              <PressableScale onPress={() => { haptic.select(); setPlanId("custom"); }} className={planId === "custom" ? "gym-kind gym-kind--selected" : "gym-kind"} style={{ minHeight: 36, paddingHorizontal: 14 }} accessibilityRole="radio" accessibilityState={{ selected: planId === "custom" }} accessibilityLabel="Custom plan">
                {planId === "custom" && <GradientFill radius={999} />}
                <Text className={planId === "custom" ? "gym-kind__label gym-kind__label--selected" : "gym-kind__label"}>Custom</Text>
              </PressableScale>
            </View>
            <PressableScale onPress={() => setAddingPlan(true)} className="gym-choice flex-row items-center self-start" style={{ gap: 6 }} accessibilityRole="button" accessibilityLabel="Add New Plan">
              <GymIcon name="plus" size={14} color={colors.gymPrimary} />
              <Text className="gym-choice__label">Add New Plan</Text>
            </PressableScale>
            {planId === "custom" && (
              <>
                <PlanLengthFields unit={unit} onUnit={setUnit} duration={duration} onDuration={setDuration} />
                <GymField label="Plan fee" icon="banknote" value={customFee} onChangeText={(t) => setCustomFee(amountInput(t))} keyboardType="number-pad" placeholder="Plan Fee (Eg. 1500)" />
              </>
            )}
            {chosen && <Text className="gym-tx__meta">{`${chosen.name}: ${planLabel(length ?? 1, lengthUnit)} · ${rupees(chosen.price)}`}</Text>}
            <View className="flex-row" style={{ gap: 10 }}>
              <View className="min-w-0 flex-1"><GymField label="Admission amount" icon="banknote" value={admission} onChangeText={(t) => setAdmission(amountInput(t))} keyboardType="number-pad" placeholder="Admission Amount" /></View>
              <View className="min-w-0 flex-1"><GymField label="Discount amount" icon="tag" value={discount} onChangeText={(t) => setDiscount(amountInput(t))} keyboardType="number-pad" placeholder="Discount Amount" /></View>
            </View>
            <ChipRow label="Mode" options={METHODS} value={method} onChange={(m) => setMethod(m)} />
            <View className="flex-row" style={{ gap: 12 }}>
              <View className="flex-1 items-center" style={{ gap: 6 }} accessible accessibilityLabel={`Amount payable ${rupees(payable)}`}>
                <Text className="gym-field__label" style={{ fontSize: 14 }}>Amount Payable</Text>
                <View className="gym-amount-box"><Text className="gym-amount-box__value">{rupees(payable)}</Text></View>
              </View>
              <View className="flex-1 items-center" style={{ gap: 6 }} accessible accessibilityLabel={`Due amount ${rupees(due)}`}>
                <Text className="gym-field__label" style={{ fontSize: 14 }}>Due Amount</Text>
                <View className="gym-amount-box"><Text className="gym-amount-box__value" style={{ color: due > 0 ? colors.gymDanger : colors.gymSuccess }}>{rupees(due)}</Text></View>
              </View>
            </View>
            <GymField label="Amount collected" icon="indian-rupee" value={collected} onChangeText={(t) => setCollected(amountInput(t))} keyboardType="number-pad" placeholder="Amount Collected" hint={paidNum > payable ? "Can't be more than the amount payable." : discountNum > planFee + admissionNum ? "The discount can't be more than the plan and admission amounts." : undefined} />
            {amountsOk && due > 0 && <DueByField value={dueBy} onChange={setDueBy} />}
            <CheckRow label="Send Invoice" checked={sendInvoice} onChange={setSendInvoice} />
            {error ? <FormAlert message={error} /> : null}
            <StepButtons onBack={() => setStep(2)} label="Add Member" ready={payReady} busy={busy} onNext={() => setConfirming(true)} />
          </>
        )}
      </GymSheet>
      {addingPlan && (
        <CatalogSheet
          kind="plan"
          item={null}
          onClose={() => setAddingPlan(false)}
          onSaved={(items) => {
            setCatalog({ items });
            const added = items.filter((i) => i.kind === "plan").sort((a, b) => b.id - a.id)[0];
            if (added) setPlanId(added.id);
            setAddingPlan(false);
          }}
        />
      )}
    </>
  );
}

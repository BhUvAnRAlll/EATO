// justFit's Terms & Conditions and Privacy Policy, shown by app/legal/[doc].tsx and linked from
// sign-in, sign-up, checkout, Subscribe, Register your gym, Profile, the gym portal's Settings and
// Super Admin › Profile. A draft written from what the app does (2026-11-10): have a lawyer review
// it and fill in LEGAL_CONTACT before launch. When the wording changes, change UPDATED too.

export type LegalDocId = "terms" | "privacy";

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  // Outside pages the section points to (opened in the browser)
  links?: { label: string; url: string }[];
};

export type LegalDoc = {
  title: string;
  intro: string;
  sections: LegalSection[];
};

export const LEGAL_UPDATED = "10 November 2026";

// To be filled in before launch: the company that runs justFit and its Grievance Officer
export const LEGAL_CONTACT = {
  company: "[Registered company name]",
  address: "[Registered address]",
  email: "[support email]",
  grievanceOfficer: "[Grievance Officer's name]",
  courts: "[city], Karnataka",
};

const contactLines = [
  `${LEGAL_CONTACT.company}, ${LEGAL_CONTACT.address}.`,
  `Email: ${LEGAL_CONTACT.email}. Grievance Officer: ${LEGAL_CONTACT.grievanceOfficer}, at the same email address.`,
];

const terms: LegalDoc = {
  title: "Terms & Conditions",
  intro:
    `These terms are an agreement between you and ${LEGAL_CONTACT.company} ("justFit", "we", "us"). They cover the justFit app and every service in it: meal ordering and subscriptions, nutrition and workout tracking, the AI Coach, Gym Hub and the gym portal. By creating an account or using the app you agree to them. If you don't agree, please don't use justFit.`,
  sections: [
    {
      heading: "1. Who can use justFit",
      paragraphs: [
        "You must be 18 or older, or use justFit with the consent and supervision of a parent or guardian.",
        "justFit is offered in India. Prices are in Indian rupees and deliveries are made only to the pincodes we serve.",
      ],
    },
    {
      heading: "2. Your account",
      paragraphs: [
        "You sign in with your Indian mobile number and a one-time code we text you. Keep your phone and codes to yourself: anything done after signing in with your number is treated as done by you.",
        "Give accurate details about yourself, and keep them up to date. One person, one account.",
        "You can sign out of every device from Profile. Tell us at once if you think someone else has used your account.",
      ],
    },
    {
      heading: "3. Health and fitness: not medical advice",
      paragraphs: [
        "justFit gives general fitness and nutrition guidance. It is not a doctor, dietitian or physiotherapist, and nothing in the app is medical advice, diagnosis or treatment.",
        "Calorie and macro targets, meal plans, workout plans and coach replies are worked out from what you tell us and may not suit your health. Talk to a doctor before starting a new diet or exercise programme, especially if you are pregnant, have a medical condition, an injury, or take medication.",
        "Body Scan gives an estimate of body fat from two photos. It is not validated against DEXA, InBody or other clinical measurements and may be wrong. Scan Food estimates calories and macros from a photo and may be wrong too.",
        "Stop exercising and get medical help if you feel pain, dizziness, shortness of breath or any other warning sign. You exercise at your own risk.",
      ],
    },
    {
      heading: "4. The AI Coach and other AI features",
      paragraphs: [
        "The AI Coach's chat, meal plans, workout weeks, Scan Food and voice transcription are produced by artificial intelligence. AI can make mistakes, misunderstand you or suggest something unsuitable. Check what it tells you, and always check ingredients yourself if you have an allergy.",
        "To give these answers, what you send to them (your messages, photos, voice clips and the profile details they need) is processed by our AI provider. See the Privacy Policy for details.",
        "We may limit how often the AI features can be used, or pause them for a while.",
      ],
    },
    {
      heading: "5. Ordering meals",
      paragraphs: [
        "You can order a meal time (breakfast, lunch or dinner) for today or up to 6 days ahead. Each meal time closes 2 hours before it starts. An order is confirmed only once its payment is confirmed.",
        "Prices, discounts and nutrition facts are those shown in the app when you pay; our own records decide the amount charged. Photos are for illustration. Nutrition facts are estimates.",
        "Ingredients are listed on each meal, but our kitchens handle common allergens (such as milk, nuts, gluten, soy, eggs and seafood) and we can't promise any meal is free of them.",
        "Make sure your delivery address and phone number are correct and that someone can receive the order. If a delivery fails because of a wrong address or because no one was available, we may not be able to refund it.",
        "Coupons follow the rules shown with them (dates, minimum order, uses per member), apply only in the app, can't be exchanged for cash, and may be withdrawn.",
      ],
    },
    {
      heading: "6. Meal subscriptions",
      paragraphs: [
        "A subscription delivers the meal you chose at your chosen meal time for the number of days in the plan, starting on the day you pick. The price and discount are those shown when you pay.",
        "You can pause, skip a day or resume from My subscriptions; paused and skipped days move the end date later. Changes for a day must be made before that day's orders are prepared.",
        "You can cancel a subscription from the app. Any refund for deliveries not yet made is worked out as shown in the app when you cancel.",
      ],
    },
    {
      heading: "7. Payments",
      paragraphs: [
        "Payments are handled by our payment partner (Razorpay). We never see or store your full card, UPI PIN or bank login details.",
        "A checkout that isn't paid within 15 minutes is cancelled. If a payment is confirmed after its meal time has closed, the order is not made and the amount is refunded.",
        "While justFit is in test mode, Pay opens a test checkout and no money is taken.",
      ],
    },
    {
      heading: "8. Cancellations, problems and refunds",
      paragraphs: [
        "You can cancel an order in the app while it is still only placed. Once the kitchen has accepted it, it can't be cancelled.",
        "If something goes wrong (a missing, wrong, damaged, late or undelivered meal), use Report a problem on the order as soon as you can. We look into every report and tell you the outcome in the app.",
        "Approved refunds go back to the original payment method, usually within 5 to 7 working days of approval, depending on your bank.",
      ],
    },
    {
      heading: "9. Gyms and Gym Hub",
      paragraphs: [
        "Gyms listed on justFit are independent businesses. justFit is a platform that lets you find gyms, ask to join and use your membership; it is not a party to your membership.",
        "Memberships, fees, renewals, pauses, refunds, rules and facilities are between you and the gym. Payments to gyms are made at the gym, not in the app. A join request sends your name, number and message to the gym; it is an enquiry, not a booking.",
        "Gym information (photos, hours, plans, prices, facilities, trainers) is provided by the gym. We check gyms before they go live but can't guarantee everything they show.",
        "Checking in with a gym's QR code uses your phone's location to confirm you are at the gym. Don't try to check in when you aren't there.",
        "Live crowd levels and forecasts are estimates from check-ins and may not match how busy the gym really is.",
      ],
    },
    {
      heading: "10. Gym partners",
      paragraphs: [
        "If you register a gym, or use the gym portal as its owner, staff or trainer, these extra terms apply.",
        "The details and documents you send must be true and yours to share. We may approve, ask for changes, reject or later suspend a gym at our discretion, for example for false information, complaints or breaking these terms.",
        "You are responsible for your gym, its staff and trainers, the logins you give them, the plans and prices you show, and the services you provide to members.",
        "Member details in the gym portal (names, numbers, photos, payments, attendance) may be used only to run your gym, and must be handled lawfully, including under India's Digital Personal Data Protection Act, 2023. Message members only about their membership, and don't send unwanted marketing.",
        "SMS credits are used one per message and are not refundable once used.",
      ],
    },
    {
      heading: "11. Reviews, reports and your content",
      paragraphs: [
        "Only members of a gym can review it. Reviews must be honest, about your own experience, and must not be abusive, defamatory, misleading, spam or contain anyone's personal details.",
        "You keep ownership of what you post, and you give justFit a free, non-exclusive licence to show it in the app for as long as it is there. Others see you as your first name and the first letter of your surname.",
        "We, and gyms for their own reviews, may hide words that break these rules. We may remove any content that breaks the law or these terms.",
      ],
    },
    {
      heading: "12. Acceptable use",
      paragraphs: [
        "Don't misuse justFit: no breaking the law, harassing anyone, impersonating someone, faking check-ins or locations, abusing coupons, scraping or copying the app's content, interfering with its security, or trying to get into accounts or data that aren't yours.",
      ],
    },
    {
      heading: "13. Videos and other services",
      paragraphs: [
        "Some workout programmes play videos from YouTube in YouTube's own player. Those videos are made by their creators, not justFit, and watching them is subject to the YouTube Terms of Service.",
        "Maps, location search, SMS and payments are provided by third parties under their own terms.",
      ],
      links: [{ label: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" }],
    },
    {
      heading: "14. Our app and brand",
      paragraphs: [
        "The justFit app, name, logo, design and content (except content made by users, gyms and video creators) belong to us or our licensors. You may use the app for your own personal use; you may not copy, sell or reverse-engineer it.",
      ],
    },
    {
      heading: "15. Availability and liability",
      paragraphs: [
        "We work to keep justFit running and accurate, but the app is provided as it is and may sometimes be unavailable, slow or wrong.",
        "To the extent the law allows, justFit is not liable for indirect or consequential loss, for injuries from exercise or food you choose, or for what gyms and other independent businesses do. Our total liability for any claim is limited to the amount you paid us in the 3 months before it. Nothing in these terms limits rights you have under the Consumer Protection Act, 2019 or other law that can't be limited.",
      ],
    },
    {
      heading: "16. Suspension and closing your account",
      paragraphs: [
        "We may suspend or close an account that breaks these terms or the law, or to protect members, gyms or justFit. Where it's safe to, we'll tell you why.",
        "You can stop using justFit at any time and ask us to delete your account (see the Privacy Policy).",
      ],
    },
    {
      heading: "17. Changes to these terms",
      paragraphs: [
        "We may update these terms as justFit changes. The date at the top shows the latest version. If a change is important we'll tell you in the app. Using justFit after a change means you accept the new terms.",
      ],
    },
    {
      heading: "18. Law and disputes",
      paragraphs: [
        `These terms are governed by the laws of India. Any dispute that can't be settled by talking to us first will be decided by the courts at ${LEGAL_CONTACT.courts}.`,
      ],
    },
    {
      heading: "19. Grievances and contact",
      paragraphs: [
        "For a complaint about an order, a gym, content or these terms, write to our Grievance Officer. We acknowledge complaints within 48 hours and aim to resolve them within one month.",
        ...contactLines,
      ],
    },
  ],
};

const privacy: LegalDoc = {
  title: "Privacy Policy",
  intro:
    `This policy explains what personal data justFit collects, why, who it is shared with and the choices you have. ${LEGAL_CONTACT.company} is responsible for your data under India's Digital Personal Data Protection Act, 2023. By using justFit you agree to this policy.`,
  sections: [
    {
      heading: "1. What we collect",
      paragraphs: [
        "Account: your mobile number and name. We have no passwords: sign-in codes and session tokens are stored only in a scrambled (hashed) form.",
        "Profile and health: date of birth, gender, height, weight, body fat, goal, activity level, health conditions you choose to tell us, food preferences, allergies and dislikes, and the targets worked out from them.",
        "AI Coach: your intake answers, plans and chat messages.",
        "Tracking: the meals, water, supplements, weigh-ins, measurements and workouts you log.",
        "Orders: delivery addresses (with the map point you choose), orders, subscriptions, problem reports and the photos you add to them, and payment references from our payment partner (never your card or bank details).",
        "Gyms: your memberships, payments the gym records, attendance (each check-in and check-out, with your phone's location reading at that moment), pause requests, join requests, reviews and complaints. If you work at a gym, your role, branches and work check-ins.",
        "Device and usage: which screens and features are used, app version and basic device details, to keep the app working and improve it.",
      ],
    },
    {
      heading: "2. Photos, voice and location",
      paragraphs: [
        "Body Scan photos and Scan Food photos are sent for analysis, used once, and not stored. Only the result you accept (your body fat estimate, or the food you log) is saved.",
        "Voice clips for the coach chat are transcribed and then deleted; only the words appear in your message box. When your phone's own speech recogniser is used, nothing is sent to us.",
        "Location is used only when you act: to find your delivery address, to sort gyms near you (rounded to about 100 metres and not stored), and to confirm you are at the gym when you check in (stored with that visit).",
        "Photos you choose to keep (a gym's logo or photos, a payment bill, a problem report) are stored on our servers and shown only to those who need them.",
      ],
    },
    {
      heading: "3. How we use your data",
      paragraphs: [
        "To run your account and sign you in; to work out your targets and plans; to take, deliver and support your orders and subscriptions; to run your gym membership and check-ins; to show the AI Coach the context it needs; to send you sign-in codes and notifications you can switch off; to prevent fraud and misuse; to understand how justFit is used and improve it; and to meet our legal obligations.",
        "We do not sell your personal data and we do not use your health data for advertising.",
      ],
    },
    {
      heading: "4. AI processing",
      paragraphs: [
        "The AI Coach, Scan Food, voice transcription and report reading use OpenAI's services. We send only what each answer needs (for a chat reply: your recent messages, your profile and today's totals and plan) and never your phone number.",
        "OpenAI processes this data for us under its terms for business customers. Body Scan photos are analysed by a scan service we run ourselves.",
        "We record each AI call's feature, size and cost to manage spending, never its words or photos.",
      ],
    },
    {
      heading: "5. Who we share it with",
      paragraphs: [
        "Gyms: a gym sees your membership, payments and attendance at that gym, and your name, number and message when you ask to join. Your reviews are shown with your first name and surname initial. Complaints about a gym go to justFit, not the gym.",
        "Kitchens and delivery: your name, phone number, address and order, to prepare and deliver it.",
        "Service providers who work for us: hosting, OpenAI (AI features), Fast2SMS (text messages), Razorpay (payments), Google (maps and YouTube videos) and your phone's maker (location and speech). They may use the data only to provide their service.",
        "Authorities, when the law requires it, or to protect someone's safety.",
      ],
    },
    {
      heading: "6. YouTube API Services",
      paragraphs: [
        "Workout programmes use YouTube API Services to show video details and play videos in YouTube's player. When you play a video, YouTube and Google receive data under the Google Privacy Policy. Video details are refreshed regularly and never kept longer than 30 days.",
      ],
      links: [
        { label: "Google Privacy Policy", url: "https://policies.google.com/privacy" },
        { label: "YouTube Terms of Service", url: "https://www.youtube.com/t/terms" },
      ],
    },
    {
      heading: "7. How long we keep it",
      paragraphs: [
        "Coach chat messages are deleted 7 days after they are written. Sign-in codes last 5 minutes and sessions 30 days.",
        "The rest of your data is kept while your account is open. When you ask us to delete your account we delete or anonymise your data, except records we must keep by law, such as invoices, payments and tax records, which are kept for as long as the law requires.",
        "A gym keeps its own records of your membership with it under its own obligations.",
      ],
    },
    {
      heading: "8. Security",
      paragraphs: [
        "Data travels over encrypted connections (HTTPS). Sign-in codes and session tokens are hashed, access is checked on every request, and staff see only what their role needs. No system is perfectly secure; if a breach affects you, we'll tell you and the authorities as the law requires.",
      ],
    },
    {
      heading: "9. Your rights and choices",
      paragraphs: [
        "You can see and correct most of your data in the app. You can also ask us for a summary of the data we hold about you, to correct or delete it, to withdraw consent, or to nominate someone to act for you if you can't.",
        "Withdrawing consent or deleting your account stops the features that need that data. To make a request, write to us at the address below; we may ask you to confirm it is your account.",
        "If you aren't satisfied with our answer, you may complain to the Data Protection Board of India.",
      ],
    },
    {
      heading: "10. Phone permissions",
      paragraphs: [
        "Camera and photos: for Body Scan, Scan Food, barcodes, QR check-in and photos you choose to add. Location: for addresses, gyms near you and check-ins. Microphone: for speaking to the coach. Notifications: for meal reminders and workout progress. Each is asked for only when you use the feature, and you can turn it off in your phone's settings.",
      ],
    },
    {
      heading: "11. Children",
      paragraphs: [
        "justFit is not meant for anyone under 18 without a parent or guardian's consent. If you believe a child has given us data without that consent, contact us and we will delete it.",
      ],
    },
    {
      heading: "12. Changes to this policy",
      paragraphs: [
        "We'll update this policy when justFit changes. The date at the top shows the latest version, and we'll tell you in the app about important changes.",
      ],
    },
    {
      heading: "13. Contact and grievances",
      paragraphs: ["For any question, request or complaint about your data, write to our Grievance Officer.", ...contactLines],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = { terms, privacy };

export const isLegalDoc = (value: unknown): value is LegalDocId => value === "terms" || value === "privacy";

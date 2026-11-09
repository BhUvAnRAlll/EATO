import { useState } from "react";
import { Text, View } from "react-native";

import { FormAlert } from "@/components/FormAlert";
import { PressableScale } from "@/components/PressableScale";
import { SymbolView } from "@/components/SymbolView";
import { MemberPhotoImage } from "@/components/gym/MemberPhotoImage";
import { RegisterFrame, WithApplication } from "@/components/gymRegister/RegisterParts";
import { pickCatalogImage, pickLogoImage, pickReceiptImage, type PhotoSource } from "@/lib/gymPhoto";
import { DOCUMENT_KINDS, MAX_DOCUMENTS, documentLabel, fileSize, registrationApi, type Application, type DocumentKind } from "@/lib/gymRegistration";
import { hud } from "@/lib/hud";
import { confirmChoice, showActions } from "@/lib/nativeSheets";
import { useSessionToken } from "@/lib/session";
import { useGymRegistration } from "@/store/gymRegistration";
import { useThemeColors } from "@/theme";

type Picker = typeof pickCatalogImage;
// The gym profile's gallery limit (JustFit_server/gym/profileRules.js MAX_PHOTOS)
const MAX_PHOTOS = 8;

// Register your gym › Photos and documents: the logo, gallery photos (the first is the cover) and the
// documents justFit checks (an address proof is required). Documents are private: only you and the
// justFit team can open them. On the phone they are photos of the papers; the server also takes PDFs.
export default function RegisterFiles() {
  return <WithApplication title="Photos and documents" render={(app) => <Files app={app} />} />;
}

function Files({ app }: { app: Application }) {
  const colors = useThemeColors();
  const getToken = useSessionToken();
  const put = useGymRegistration((state) => state.put);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asks camera or library, picks, then runs `upload` with the picked file
  const pickThen = (title: string, picker: Picker, upload: (file: { data: string; mediaType: string }, token: string | null) => Promise<{ ok: true; data: Application } | { ok: false; error: string }>, busyKey: string) => {
    const go = async (source: PhotoSource) => {
      setError(null);
      const picked = await picker(source);
      if (!picked.ok) return "error" in picked ? setError(picked.error) : undefined;
      setBusy(busyKey);
      const answer = await upload({ data: picked.photo.data, mediaType: picked.photo.mediaType }, await getToken().catch(() => null));
      setBusy(null);
      if (!answer.ok) return setError(answer.error);
      put(answer.data);
      hud.success("Uploaded");
    };
    showActions({ title, actions: [{ label: "Take a photo", onPress: () => void go("camera") }, { label: "Choose from library", onPress: () => void go("library") }] });
  };

  const remove = async (what: string, run: (token: string | null) => Promise<{ ok: true; data: Application } | { ok: false; error: string }>) => {
    if (!(await confirmChoice({ title: `Remove ${what}?`, confirmLabel: "Remove" }))) return;
    setError(null);
    const answer = await run(await getToken().catch(() => null));
    if (!answer.ok) return setError(answer.error);
    put(answer.data);
    hud.success("Removed");
  };

  const addDocument = (kind: DocumentKind) =>
    pickThen(`Add ${documentLabel(kind).toLowerCase()}`, pickReceiptImage, (file, token) => registrationApi.addDocument(token, app.id, kind, file), `doc-${kind}`);

  return (
    <RegisterFrame title="Photos and documents">
      {error ? <FormAlert message={error} /> : null}

      <Text className="setup__section">Logo</Text>
      <View className="card flex-row items-center" style={{ gap: 12 }}>
        <View className="overflow-hidden rounded-md bg-cream-deep" style={{ width: 56, height: 56 }}>
          {app.logoUrl ? <MemberPhotoImage url={app.logoUrl} fit="contain" /> : null}
        </View>
        <Text className="type-body text-muted flex-1">{app.logoUrl ? "Your gym's logo" : "Add your logo (optional)"}</Text>
        <UploadButton label={app.logoUrl ? "Change" : "Add"} busy={busy === "logo"} onPress={() => pickThen("Gym logo", pickLogoImage, (file, token) => registrationApi.setLogo(token, app.id, file), "logo")} />
      </View>

      <Text className="setup__section mt-2">Photos</Text>
      <Text className="type-caption text-muted">The first photo is the cover members see. Up to {MAX_PHOTOS}.</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {app.photos.map((photo, index) => (
          <PressableScale key={photo.id} onPress={() => remove(index === 0 ? "the cover photo" : "this photo", (token) => registrationApi.removePhoto(token, app.id, photo.id))} className="overflow-hidden rounded-md bg-cream-deep" style={{ width: 104, height: 78 }} accessibilityRole="button" accessibilityLabel={`${index === 0 ? "Cover photo" : `Photo ${index + 1}`}. Tap to remove`}>
            <MemberPhotoImage url={photo.url} />
            {index === 0 ? <View className="absolute bottom-1 left-1 rounded-pill bg-inverse px-2 py-0.5"><Text className="type-caption text-on-inverse">Cover</Text></View> : null}
          </PressableScale>
        ))}
        {app.photos.length < MAX_PHOTOS ? (
          <PressableScale onPress={() => pickThen("Gym photo", pickCatalogImage, (file, token) => registrationApi.addPhoto(token, app.id, file), "photo")} disabled={busy === "photo"} className="items-center justify-center rounded-md border border-dashed border-line-strong" style={{ width: 104, height: 78 }} accessibilityRole="button" accessibilityLabel="Add a photo">
            <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={20} tintColor={colors.primaryText} />
            <Text className="type-caption text-primary-text">{busy === "photo" ? "Uploading…" : "Add photo"}</Text>
          </PressableScale>
        ) : null}
      </View>

      <Text className="setup__section mt-2">Documents</Text>
      <Text className="type-caption text-muted">Private: only you and the justFit team can open them. Take a clear photo of each page.</Text>
      {DOCUMENT_KINDS.map((kind) => {
        const docs = app.documents.filter((d) => d.kind === kind.id);
        return (
          <View key={kind.id} className="card" style={{ gap: 8 }}>
            <View className="flex-row items-start" style={{ gap: 12 }}>
              <View className="flex-1" style={{ gap: 2 }}>
                <Text className="card__title">{kind.label}</Text>
                <Text className="type-caption text-muted">{kind.hint}</Text>
              </View>
              {app.documents.length < MAX_DOCUMENTS ? <UploadButton label="Add" busy={busy === `doc-${kind.id}`} onPress={() => addDocument(kind.id)} /> : null}
            </View>
            {docs.map((doc, i) => (
              <View key={doc.id} className="flex-row items-center" style={{ gap: 10 }}>
                <SymbolView name={{ ios: "doc.text", android: "description", web: "description" }} size={18} tintColor={colors.primaryText} />
                <Text className="type-body flex-1">{kind.label}{docs.length > 1 ? ` ${i + 1}` : ""} · {fileSize(doc.bytes)}</Text>
                <PressableScale onPress={() => remove("this document", (token) => registrationApi.removeDocument(token, app.id, doc.id))} accessibilityRole="button" accessibilityLabel={`Remove ${kind.label}`} hitSlop={8}>
                  <Text className="type-caption text-danger">Remove</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        );
      })}
    </RegisterFrame>
  );
}

function UploadButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} disabled={busy} className="address-action" accessibilityRole="button" accessibilityState={{ busy }}>
      <Text className="address-action__label text-primary-text">{busy ? "Uploading…" : label}</Text>
    </PressableScale>
  );
}

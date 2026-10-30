#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="/tmp/android-toolchain"
mkdir -p "$TOOLCHAIN"

# 1. Provision portable OpenJDK 17 if not cached in /tmp
if [ ! -x "$TOOLCHAIN/jdk/bin/javac" ]; then
  echo "Downloading OpenJDK 17..."
  curl -sL "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" -o "$TOOLCHAIN/jdk17.tar.gz"
  mkdir -p "$TOOLCHAIN/jdk"
  tar -xzf "$TOOLCHAIN/jdk17.tar.gz" -C "$TOOLCHAIN/jdk" --strip-components=1
  rm -f "$TOOLCHAIN/jdk17.tar.gz"
fi

export JAVA_HOME="$TOOLCHAIN/jdk"
export PATH="$JAVA_HOME/bin:$PATH"

# 2. Provision Android SDK 34 platform & build-tools 34.0.0 if not cached in /tmp
if [ ! -x "$TOOLCHAIN/sdk/build-tools/34.0.0/aapt2" ]; then
  echo "Downloading Android SDK 34 build-tools..."
  curl -sL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o "$TOOLCHAIN/cmdline.zip"
  mkdir -p "$TOOLCHAIN/sdk/cmdline-tools"
  unzip -q "$TOOLCHAIN/cmdline.zip" -d "$TOOLCHAIN/sdk/cmdline-tools"
  mv "$TOOLCHAIN/sdk/cmdline-tools/cmdline-tools" "$TOOLCHAIN/sdk/cmdline-tools/latest"
  rm -f "$TOOLCHAIN/cmdline.zip"
  yes | "$TOOLCHAIN/sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$TOOLCHAIN/sdk" --licenses >/dev/null 2>&1 || true
  "$TOOLCHAIN/sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$TOOLCHAIN/sdk" "platforms;android-34" "build-tools;34.0.0" >/dev/null
fi

AAPT2="$TOOLCHAIN/sdk/build-tools/34.0.0/aapt2"
D8="$TOOLCHAIN/sdk/build-tools/34.0.0/d8"
ZIPALIGN="$TOOLCHAIN/sdk/build-tools/34.0.0/zipalign"
APKSIGNER="$TOOLCHAIN/sdk/build-tools/34.0.0/apksigner"
ANDROID_JAR="$TOOLCHAIN/sdk/platforms/android-34/android.jar"

# 3. Ensure deterministic release keystore exists for seamless APK upgrades
KEYSTORE="$ROOT_DIR/app/jbl-release-key.jks"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -alias jbl320key \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass jblpb320hebrew -keypass jblpb320hebrew \
    -dname "CN=Ash HaTorah, OU=Native Android, O=JBLPartyBox320HE, L=IL, ST=IL, C=IL" >/dev/null 2>&1
fi

BUILD_TMP="/tmp/jbl-native-build"
rm -rf "$BUILD_TMP"
mkdir -p "$BUILD_TMP/compiled_res" "$BUILD_TMP/gen" "$BUILD_TMP/classes" "$BUILD_TMP/dex" "$BUILD_TMP/test_classes"

# 4. Compile VectorDrawable SVGs & resources with aapt2
sed 's|<manifest xmlns:android="http://schemas.android.com/apk/res/android">|<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.jblpartybox320.hebrewcontrol">|' \
  "$ROOT_DIR/app/src/main/AndroidManifest.xml" > "$BUILD_TMP/AndroidManifest.aapt2.xml"
"$AAPT2" compile --dir "$ROOT_DIR/app/src/main/res" -o "$BUILD_TMP/compiled_res/res.zip"
"$AAPT2" link \
  -I "$ANDROID_JAR" \
  --manifest "$BUILD_TMP/AndroidManifest.aapt2.xml" \
  --java "$BUILD_TMP/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 5 \
  --version-name "0.3.0" \
  -o "$BUILD_TMP/unsigned-unaligned.apk" \
  "$BUILD_TMP/compiled_res/res.zip"

# 5. Compile 100% Native Java 17 sources (strict low-memory cap -J-Xmx384m)
mapfile -t JAVA_SRCS < <(find "$ROOT_DIR/app/src/main/java" "$BUILD_TMP/gen" -name "*.java")
javac -J-Xmx384m -encoding UTF-8 --release 17 \
  -classpath "$ANDROID_JAR" \
  -d "$BUILD_TMP/classes" \
  "${JAVA_SRCS[@]}"

# 6. Run JUnit 4 Unit Tests against compiled native classes
if [ ! -f "$TOOLCHAIN/junit-4.13.2.jar" ]; then
  curl -sL "https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar" -o "$TOOLCHAIN/junit-4.13.2.jar"
  curl -sL "https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar" -o "$TOOLCHAIN/hamcrest-core-1.3.jar"
fi
javac -J-Xmx256m -encoding UTF-8 --release 17 \
  -classpath "$BUILD_TMP/classes:$ANDROID_JAR:$TOOLCHAIN/junit-4.13.2.jar:$TOOLCHAIN/hamcrest-core-1.3.jar" \
  -d "$BUILD_TMP/test_classes" \
  "$ROOT_DIR/app/src/test/java/com/jblpartybox320/hebrewcontrol/JblNativeCoreTest.java"
java -Xmx256m \
  -classpath "$BUILD_TMP/test_classes:$BUILD_TMP/classes:$ANDROID_JAR:$TOOLCHAIN/junit-4.13.2.jar:$TOOLCHAIN/hamcrest-core-1.3.jar" \
  org.junit.runner.JUnitCore com.jblpartybox320.hebrewcontrol.JblNativeCoreTest

# 7. Dex classes with d8 (-J-Xmx384m) & package into APK
mapfile -t CLASS_FILES < <(find "$BUILD_TMP/classes" -name "*.class")
"$D8" -JXmx384m --min-api 24 --lib "$ANDROID_JAR" --output "$BUILD_TMP/dex" "${CLASS_FILES[@]}"

(cd "$BUILD_TMP/dex" && python3 -c "
import zipfile
with zipfile.ZipFile('$BUILD_TMP/unsigned-unaligned.apk', 'a', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write('classes.dex', 'classes.dex')
")

# 8. Zipalign & Sign (v1 + v2 + v3)
"$ZIPALIGN" -f -p 4 "$BUILD_TMP/unsigned-unaligned.apk" "$BUILD_TMP/aligned.apk"
mkdir -p "$ROOT_DIR/public"
OUT_APK="$ROOT_DIR/public/JBL-PartyBox-320-HE.apk"
OUT_ZIP="$ROOT_DIR/public/JBL-PartyBox-320-HE-APK.zip"

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias jbl320key \
  --ks-pass pass:jblpb320hebrew \
  --key-pass pass:jblpb320hebrew \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$OUT_APK" \
  "$BUILD_TMP/aligned.apk"

"$APKSIGNER" verify --verbose "$OUT_APK" | head -n 6

# 9. Package companion ZIP with Hebrew install README & write apk-metadata.json
cat << 'EOF' > "$BUILD_TMP/README-INSTALL-HE.txt"
JBL PartyBox Stage 320 — אפליקציית שליטה נייטיב בעברית (100% Native Android)
פיתוח: "אש התורה"
GitHub: https://github.com/ES2323ES
מתמחים טופ: https://mitmachim.top/user/%D7%90%D7%A9-%D7%94%D7%AA%D7%95%D7%A8%D7%94

הוראות התקנה:
1. פתח את הקובץ JBL-PartyBox-320-HE.apk במכשיר האנדרואיד (גרסה 7.0 ומעלה).
2. אם מותקנת במכשיר גרסת ה-WebView הישנה (0.2.x), הסר אותה פעם אחת לפני התקנת גרסת ה-Native החדשה.
3. לעדכונים עתידיים ניתן להשתמש בכפתור "עדכון אוטומטי מ-GitHub Releases" מתוך מסך ההגדרות (למעלה מימין).
EOF

python3 -c "
import zipfile, hashlib, json, os, datetime

apk_path = '$OUT_APK'
zip_path = '$OUT_ZIP'
readme_path = '$BUILD_TMP/README-INSTALL-HE.txt'

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(apk_path, 'JBL-PartyBox-320-HE.apk')
    zf.write(readme_path, 'README-INSTALL-HE.txt')

with open(apk_path, 'rb') as f:
    apk_bytes = f.read()
apk_sha = hashlib.sha256(apk_bytes).hexdigest()

meta = {
    'appName': 'JBL PartyBox 320',
    'packageName': 'com.jblpartybox320.hebrewcontrol',
    'versionName': '0.3.0',
    'versionCode': 5,
    'architecture': '100% Native Android (Java 17 + Vector SVG)',
    'developer': 'אש התורה',
    'minSdk': 24,
    'targetSdk': 34,
    'apkSizeBytes': len(apk_bytes),
    'zipSizeBytes': os.path.getsize(zip_path),
    'sha256': apk_sha,
    'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat()
}
with open('$ROOT_DIR/public/apk-metadata.json', 'w', encoding='utf-8') as mf:
    json.dump(meta, mf, ensure_ascii=False, indent=2)

print('APK_BUILT_OK:', len(apk_bytes), 'bytes | SHA256:', apk_sha[:16])
"

# Template only: generate this Cask from release-metadata.json before copying
# this directory to estelwalks/homebrew-aitracker.
cask "aitracker" do
  # Template only. Replace every placeholder by running the metadata generator.
  download_url = on_arch_conditional(
    arm:   "__ARM64_IMMUTABLE_GITHUB_RELEASE_URL__",
    intel: "__X64_IMMUTABLE_GITHUB_RELEASE_URL__",
  )

  version "__VERSION__"
  sha256 arm:   "__ARM64_SHA256__",
         intel: "__X64_SHA256__"

  url download_url
  name "AITracker"
  desc "Local-first AI development asset dashboard"
  homepage "https://github.com/estelwalks/aitracker"

  depends_on macos: :big_sur

  app "AITracker.app"

  uninstall quit: "com.aitracker.desktop"

  zap trash: [
    "~/.aitracker",
    "~/Library/Application Support/AITracker",
    "~/Library/Preferences/com.aitracker.desktop.plist",
    "~/Library/Saved Application State/com.aitracker.desktop.savedState",
  ]
end

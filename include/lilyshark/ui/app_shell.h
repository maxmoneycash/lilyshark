#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace lilyshark {

// Analyzer is a sentinel. The existing analyzer Screen enum and its selected
// screen remain owned by the application that integrates this shell model.
enum class ShellRoute : std::uint8_t {
    Analyzer = 0,
    Splash,
    OnboardingWelcome,
    OnboardingCapabilities,
    OnboardingNetwork,
    OnboardingProfile,
    OnboardingControls,
    OnboardingReadiness,
    Home,
    RadioProfiles,
    Settings,
    Storage,
    DeviceStatus,
    DisplayInput,
    Help,
    About,
    SpectrumConfirmation,
    ResetConfirmation,
    Count,
};

enum class ShellRouteClass : std::uint8_t {
    Invalid = 0,
    Analyzer,
    Startup,
    Onboarding,
    Menu,
    Detail,
    Confirmation,
};

enum class SelectionMove : std::int8_t {
    Previous = -1,
    Next = 1,
};

enum class HomeItem : std::uint8_t {
    Traffic = 0,
    Spectrum,
    Nodes,
    Map,
    Survey,
    Utilization,
    Events,
    Settings,
    Protocols,
    Timeline,
    Count,
};

enum class SettingsItem : std::uint8_t {
    RadioProfiles = 0,
    Storage,
    DeviceStatus,
    DisplayInput,
    Help,
    About,
    ResetSetup,
    Count,
};

[[nodiscard]] ShellRouteClass classifyShellRoute(ShellRoute route) noexcept;
[[nodiscard]] bool isOnboardingRoute(ShellRoute route) noexcept;
[[nodiscard]] ShellRoute routeForSettingsItem(SettingsItem item) noexcept;

class AppShell
{
  public:
    static constexpr std::size_t kBackStackCapacity = 8U;

    [[nodiscard]] ShellRoute route() const noexcept { return route_; }
    [[nodiscard]] bool canGoBack() const noexcept { return back_depth_ != 0U; }
    [[nodiscard]] bool backTarget(ShellRoute &target) const noexcept;

    // open() records the current route. replace() leaves the back stack intact.
    // Both reject ShellRoute::Count and invalid enum values.
    [[nodiscard]] bool open(ShellRoute next) noexcept;
    [[nodiscard]] bool replace(ShellRoute next) noexcept;
    [[nodiscard]] bool goBack() noexcept;
    void closeToAnalyzer() noexcept;

    // Resolves the boot splash and starts either setup or the normal Home menu.
    void finishSplash(bool setup_complete) noexcept;
    void beginOnboarding() noexcept;
    [[nodiscard]] bool advanceOnboarding() noexcept;
    [[nodiscard]] bool retreatOnboarding() noexcept;

    [[nodiscard]] HomeItem homeSelection() const noexcept { return home_selection_; }
    void setHomeSelection(std::size_t index) noexcept;
    void moveHomeSelection(SelectionMove move) noexcept;

    [[nodiscard]] std::size_t profileSelection() const noexcept { return profile_selection_; }
    void setProfileSelection(std::size_t index, std::size_t profile_count) noexcept;
    void moveProfileSelection(SelectionMove move, std::size_t profile_count) noexcept;

    [[nodiscard]] SettingsItem settingsSelection() const noexcept { return settings_selection_; }
    void setSettingsSelection(std::size_t index) noexcept;
    void moveSettingsSelection(SelectionMove move) noexcept;

  private:
    void clearBackStack() noexcept;

    ShellRoute route_ = ShellRoute::Splash;
    std::array<ShellRoute, kBackStackCapacity> back_stack_{};
    std::size_t back_depth_ = 0U;
    HomeItem home_selection_ = HomeItem::Traffic;
    std::size_t profile_selection_ = 0U;
    SettingsItem settings_selection_ = SettingsItem::RadioProfiles;
};

} // namespace lilyshark

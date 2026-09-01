#include "lilyshark/ui/app_shell.h"

namespace lilyshark {
namespace {

constexpr std::size_t kHomeItemCount = static_cast<std::size_t>(HomeItem::Count);
constexpr std::size_t kSettingsItemCount = static_cast<std::size_t>(SettingsItem::Count);

std::size_t wrappedIndex(std::size_t current, std::size_t count,
                         SelectionMove move) noexcept
{
    if (count == 0U) {
        return 0U;
    }

    current %= count;
    if (move == SelectionMove::Previous) {
        return current == 0U ? count - 1U : current - 1U;
    }
    return current + 1U == count ? 0U : current + 1U;
}

} // namespace

ShellRouteClass classifyShellRoute(ShellRoute route) noexcept
{
    switch (route) {
    case ShellRoute::Analyzer:
        return ShellRouteClass::Analyzer;
    case ShellRoute::Splash:
        return ShellRouteClass::Startup;
    case ShellRoute::OnboardingWelcome:
    case ShellRoute::OnboardingCapabilities:
    case ShellRoute::OnboardingNetwork:
    case ShellRoute::OnboardingProfile:
    case ShellRoute::OnboardingControls:
    case ShellRoute::OnboardingReadiness:
        return ShellRouteClass::Onboarding;
    case ShellRoute::Home:
    case ShellRoute::RadioProfiles:
    case ShellRoute::Settings:
    case ShellRoute::ChannelKeys:
        return ShellRouteClass::Menu;
    case ShellRoute::Storage:
    case ShellRoute::DeviceStatus:
    case ShellRoute::DisplayInput:
    case ShellRoute::Help:
    case ShellRoute::About:
    case ShellRoute::RadioTuning:
        return ShellRouteClass::Detail;
    case ShellRoute::SpectrumConfirmation:
    case ShellRoute::ResetConfirmation:
        return ShellRouteClass::Confirmation;
    case ShellRoute::Count:
    default:
        return ShellRouteClass::Invalid;
    }
}

bool isOnboardingRoute(ShellRoute route) noexcept
{
    return classifyShellRoute(route) == ShellRouteClass::Onboarding;
}

ShellRoute routeForSettingsItem(SettingsItem item) noexcept
{
    switch (item) {
    case SettingsItem::RadioProfiles:
        return ShellRoute::RadioProfiles;
    case SettingsItem::Storage:
        return ShellRoute::Storage;
    case SettingsItem::DeviceStatus:
        return ShellRoute::DeviceStatus;
    case SettingsItem::DisplayInput:
        return ShellRoute::DisplayInput;
    case SettingsItem::Help:
        return ShellRoute::Help;
    case SettingsItem::About:
        return ShellRoute::About;
    case SettingsItem::ResetSetup:
        return ShellRoute::ResetConfirmation;
    case SettingsItem::RadioTuning:
        return ShellRoute::RadioTuning;
    case SettingsItem::ChannelKeys:
        return ShellRoute::ChannelKeys;
    case SettingsItem::Count:
    default:
        return ShellRoute::Settings;
    }
}

bool AppShell::backTarget(ShellRoute &target) const noexcept
{
    if (!canGoBack()) {
        return false;
    }
    target = back_stack_[back_depth_ - 1U];
    return true;
}

bool AppShell::open(ShellRoute next) noexcept
{
    if (classifyShellRoute(next) == ShellRouteClass::Invalid) {
        return false;
    }
    if (next == route_) {
        return true;
    }
    if (back_depth_ == back_stack_.size()) {
        return false;
    }

    back_stack_[back_depth_] = route_;
    ++back_depth_;
    route_ = next;
    return true;
}

bool AppShell::replace(ShellRoute next) noexcept
{
    if (classifyShellRoute(next) == ShellRouteClass::Invalid) {
        return false;
    }
    route_ = next;
    return true;
}

bool AppShell::goBack() noexcept
{
    if (!canGoBack()) {
        return false;
    }
    --back_depth_;
    route_ = back_stack_[back_depth_];
    return true;
}

void AppShell::closeToAnalyzer() noexcept
{
    clearBackStack();
    route_ = ShellRoute::Analyzer;
}

void AppShell::finishSplash(bool setup_complete) noexcept
{
    clearBackStack();
    route_ = setup_complete ? ShellRoute::Home : ShellRoute::OnboardingWelcome;
}

void AppShell::beginOnboarding() noexcept
{
    clearBackStack();
    route_ = ShellRoute::OnboardingWelcome;
}

bool AppShell::advanceOnboarding() noexcept
{
    switch (route_) {
    case ShellRoute::OnboardingWelcome:
        route_ = ShellRoute::OnboardingCapabilities;
        return true;
    case ShellRoute::OnboardingCapabilities:
        route_ = ShellRoute::OnboardingNetwork;
        return true;
    case ShellRoute::OnboardingNetwork:
        route_ = ShellRoute::OnboardingProfile;
        return true;
    case ShellRoute::OnboardingProfile:
        route_ = ShellRoute::OnboardingControls;
        return true;
    case ShellRoute::OnboardingControls:
        route_ = ShellRoute::OnboardingReadiness;
        return true;
    case ShellRoute::OnboardingReadiness:
        clearBackStack();
        route_ = ShellRoute::Home;
        return true;
    default:
        return false;
    }
}

bool AppShell::retreatOnboarding() noexcept
{
    switch (route_) {
    case ShellRoute::OnboardingCapabilities:
        route_ = ShellRoute::OnboardingWelcome;
        return true;
    case ShellRoute::OnboardingNetwork:
        route_ = ShellRoute::OnboardingCapabilities;
        return true;
    case ShellRoute::OnboardingProfile:
        route_ = ShellRoute::OnboardingNetwork;
        return true;
    case ShellRoute::OnboardingReadiness:
        route_ = ShellRoute::OnboardingControls;
        return true;
    case ShellRoute::OnboardingControls:
        route_ = ShellRoute::OnboardingProfile;
        return true;
    default:
        return false;
    }
}

void AppShell::setHomeSelection(std::size_t index) noexcept
{
    home_selection_ = static_cast<HomeItem>(index % kHomeItemCount);
}

void AppShell::moveHomeSelection(SelectionMove move) noexcept
{
    const std::size_t current = static_cast<std::size_t>(home_selection_);
    home_selection_ = static_cast<HomeItem>(wrappedIndex(current, kHomeItemCount, move));
}

void AppShell::setProfileSelection(std::size_t index, std::size_t profile_count) noexcept
{
    profile_selection_ = profile_count == 0U ? 0U : index % profile_count;
}

void AppShell::moveProfileSelection(SelectionMove move, std::size_t profile_count) noexcept
{
    profile_selection_ = wrappedIndex(profile_selection_, profile_count, move);
}

void AppShell::setSettingsSelection(std::size_t index) noexcept
{
    settings_selection_ = static_cast<SettingsItem>(index % kSettingsItemCount);
}

void AppShell::moveSettingsSelection(SelectionMove move) noexcept
{
    const std::size_t current = static_cast<std::size_t>(settings_selection_);
    settings_selection_ =
        static_cast<SettingsItem>(wrappedIndex(current, kSettingsItemCount, move));
}

void AppShell::clearBackStack() noexcept
{
    back_depth_ = 0U;
}

} // namespace lilyshark

// CashChase Settings, SwiftUI version of the web Settings dialog (webapp/index.html #settings-modal).
// Same five sections, same wording, same tokens as webapp/css/style.css.
// Not compiled or run yet: drop it into an Xcode 15+ (iOS 17) project to try it.
import SwiftUI

// MARK: Design tokens (match :root in style.css)
extension Color {
    static let ccNavy  = Color(red: 0x04/255, green: 0x29/255, blue: 0x70/255)   // #042970
    static let ccBlue  = Color(red: 0x01/255, green: 0x52/255, blue: 0xFC/255)   // #0152FC
    static let ccSky   = Color(red: 0x01/255, green: 0xAA/255, blue: 0xFC/255)   // #01AAFC
    static let ccCyan  = Color(red: 0x01/255, green: 0xE3/255, blue: 0xFB/255)   // #01E3FB
    static let ccMuted = Color(red: 0x5B/255, green: 0x6B/255, blue: 0x85/255)   // #5B6B85
    static let ccTint  = Color(red: 0xE6/255, green: 0xEE/255, blue: 0xFF/255)   // #E6EEFF
}

enum SettingsSection: String, CaseIterable, Identifiable {
    case business, team, pricing, activity, advanced
    var id: String { rawValue }
    var title: String {
        switch self {
        case .business: "Business"
        case .team: "Team & permissions"
        case .pricing: "Pricing & AI rules"
        case .activity: "Activity"
        case .advanced: "Advanced"
        }
    }
    var hint: String {
        switch self {
        case .business: "Type, setup, follow-up time"
        case .team: "What Staff can do"
        case .pricing: "Presets and what the AI follows"
        case .activity: "Who did what"
        case .advanced: "AI prompts and connection"
        }
    }
    var symbol: String {
        switch self {
        case .business: "sparkles"
        case .team: "person.2"
        case .pricing: "shippingbox"
        case .activity: "clock"
        case .advanced: "gearshape"
        }
    }
}

enum StaffMode: String, CaseIterable { case allowed = "Allowed", approval = "Needs approval", off = "Off" }

// MARK: Screens
struct SettingsView: View {
    @State private var selection: SettingsSection? = .business
    var body: some View {
        // Sidebar on iPad and Mac, a drill-down list on iPhone
        NavigationSplitView {
            List(SettingsSection.allCases, selection: $selection) { s in
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.ccNavy)
                        Text(s.hint).font(.caption).foregroundStyle(Color.ccMuted)
                    }
                } icon: {
                    Image(systemName: s.symbol)
                        .frame(width: 34, height: 34)
                        .background(Color.ccTint, in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(Color.ccBlue)
                }
                .tag(s)
                .frame(minHeight: 44)                       // 44pt touch target
            }
            .navigationTitle("Settings")
        } detail: {
            if let s = selection { SettingsDetail(section: s).navigationTitle(s.title) }
        }
        .tint(.ccBlue)
    }
}

struct SettingsDetail: View {
    let section: SettingsSection
    var body: some View {
        switch section {
        case .business: BusinessSettings()
        case .team: TeamSettings()
        case .pricing: PricingSettings()
        case .activity: ActivitySettings()
        case .advanced: AdvancedSettings()
        }
    }
}

struct BusinessSettings: View {
    @State private var business = "Air-cond contractor · Sejuk Jaya"
    @State private var followUpHours = 2          // new default, same as backend/schema/seeds/defaults.json
    @State private var marginFloor = 15.0
    var body: some View {
        Form {
            Section("Active business") {
                Picker("Business", selection: $business) {
                    ForEach(["Air-cond contractor · Sejuk Jaya", "Software studio · NexaByte IT", "Wholesale F&B · Kopi & Bakery"], id: \.self, content: Text.init)
                }
                Text("Switch to test a different kind of SME.").font(.caption).foregroundStyle(Color.ccMuted)
            }
            Section("Your rules") {
                Stepper("Follow up a quote after \(followUpHours) h", value: $followUpHours, in: 1...720)
                VStack(alignment: .leading) {
                    Text("Lowest margin allowed: \(marginFloor, specifier: "%.0f")%")
                    Slider(value: $marginFloor, in: 0...60, step: 1)
                    Text("Deeper discounts go to the Owner.").font(.caption).foregroundStyle(Color.ccMuted)
                }
            }
        }
    }
}

struct TeamSettings: View {
    @State private var modes: [String: StaffMode] = [
        "Log inquiry / send quote": .allowed, "Send follow-up": .allowed,
        "Mark deal won": .allowed, "Mark deal lost": .approval, "Give a discount": .allowed,
    ]
    var body: some View {
        Form {
            Section {
                ForEach(modes.keys.sorted(), id: \.self) { action in
                    Picker(action, selection: Binding(get: { modes[action] ?? .allowed }, set: { modes[action] = $0 })) {
                        ForEach(StaffMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
            } header: { Text("What Staff can do") } footer: {
                Text("You always have full access. \"Needs approval\" shows up under Owner approvals.")
            }
        }
    }
}

struct PricingSettings: View {
    @State private var rules = "1. Standard installation labor: RM 250/unit.\n2. Extra copper piping: RM 150 per 3m set."
    var body: some View {
        Form {
            Section("Start from a preset") {
                ForEach([("Contractor", "Per-unit labour + piping"), ("Software / agency", "Man-day rate + changes"),
                         ("Wholesale / F&B", "Delivery + urgent lorry"), ("Custom shop", "Flat fee + upgrades")], id: \.0) { p in
                    Button { rules = "" } label: {
                        VStack(alignment: .leading) { Text(p.0).foregroundStyle(Color.ccBlue); Text(p.1).font(.caption).foregroundStyle(Color.ccMuted) }
                    }
                }
            }
            Section("Rules the AI follows") { TextEditor(text: $rules).frame(minHeight: 140).font(.system(.footnote, design: .monospaced)) }
        }
    }
}

struct ActivitySettings: View {
    let log = ["[OWNER] Setting changed · Follow-up after: 48h → 2h", "[Aina] Sent follow-up 2 on Kedai Runcit Ah Seng"]
    var body: some View {
        List(log, id: \.self) { Text($0).font(.system(.footnote, design: .monospaced)).foregroundStyle(Color.ccMuted) }
    }
}

struct AdvancedSettings: View {
    @State private var url = "http://127.0.0.1:1234/v1"
    @State private var model = "local-model"
    var body: some View {
        Form {
            Section { Label("For developers. You don't need this to run your business.", systemImage: "exclamationmark.triangle").font(.footnote) }
            Section("LM Studio connection") {
                TextField("Base URL", text: $url).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Model ID", text: $model).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Save & test") {}.buttonStyle(.borderedProminent)
            }
        }
    }
}

#Preview { SettingsView() }

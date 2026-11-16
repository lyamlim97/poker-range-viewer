import { useState } from "react";
import { actionColor } from "../utils/actions";
import { getCombosForHand } from "../utils/parseRange";

const SUIT_ICONS = {
	s: "♠",
	h: "♥",
	d: "♦",
	c: "♣",
};

const SUIT_COLORS = {
	s: "#94a3b8", // Spades (slate/light silver)
	h: "#f87171", // Hearts (red)
	d: "#60a5fa", // Diamonds (blue)
	c: "#4ade80", // Clubs (green)
};

export default function HandDetail({
	hand,
	handActions = {},
	comboFreq = {},
	allActions = [],
}) {
	const [activeTab, setActiveTab] = useState("hands"); // "hands" | "summary"

	if (!hand) {
		return (
			<div className="rv-hand-detail rv-empty-msg">
				Hover over or click a hand in the grid to inspect combos
			</div>
		);
	}

	const combos = getCombosForHand(hand);
	const type = hand.length === 2 ? "Pair" : hand.endsWith("s") ? "Suited" : "Offsuit";
	const maxCombos = combos.length;

	// Calculate hand-level total frequencies
	const actionEntries = Object.entries(handActions).filter(([, f]) => f > 0);
	const totalActionFreq = actionEntries.reduce((sum, [, f]) => sum + f, 0);

	return (
		<div className="rv-hand-detail">
			<div className="rv-hd-header">
				<div className="rv-hd-title">
					<span className="rv-hd-hand-name">{hand}</span>
					<span className="rv-hd-hand-type">
						{type} · {maxCombos} combos
					</span>
				</div>
				<div className="rv-hd-tabs">
					<button
						className={`rv-hd-tab ${activeTab === "hands" ? "active" : ""}`}
						onClick={() => setActiveTab("hands")}
					>
						Hands
					</button>
					<button
						className={`rv-hd-tab ${activeTab === "summary" ? "active" : ""}`}
						onClick={() => setActiveTab("summary")}
					>
						Summary
					</button>
				</div>
			</div>

			{activeTab === "hands" ? (
				<div
					className={`rv-combos-grid ${
						type === "Suited" ? "suited" : type === "Pair" ? "pair" : "offsuit"
					}`}
				>
					{combos.map((combo) => {
						// Retrieve specific combo actions if available, else hand actions
						const actionsForCombo = (comboFreq && comboFreq[combo.id]) || handActions || {};
						const comboEntries = Object.entries(actionsForCombo).filter(
							([, f]) => f > 0
						);

						// Determine which actions to show in the list
						const actionsToShow =
							allActions.length > 0
								? allActions
								: Object.keys(actionsForCombo);

						return (
							<div key={combo.id} className="rv-combo-card">
								{/* Background action proportion bars */}
								<div className="rv-combo-bg-bars">
									{comboEntries.map(([action, freq]) => (
										<div
											key={action}
											className="rv-combo-bg-bar"
											style={{
												width: `${freq * 100}%`,
												backgroundColor: actionColor(action),
											}}
										/>
									))}
								</div>

								{/* Card Badges Header */}
								<div className="rv-combo-badge-row">
									<span
										className="rv-card-badge"
										style={{ color: SUIT_COLORS[combo.card1.suit] }}
									>
										{combo.card1.rank}
										{SUIT_ICONS[combo.card1.suit]}
									</span>
									<span
										className="rv-card-badge"
										style={{ color: SUIT_COLORS[combo.card2.suit] }}
									>
										{combo.card2.rank}
										{SUIT_ICONS[combo.card2.suit]}
									</span>
								</div>

								{/* Action details list */}
								<div className="rv-combo-actions-list">
									{actionsToShow.map((action) => {
										const freq = (actionsForCombo[action] || 0) * 100;
										return (
											<div key={action} className="rv-combo-action-row">
												<span className="rv-combo-act-name">{action}</span>
												<span className="rv-combo-act-val">
													{freq.toFixed(1)}
												</span>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			) : (
				<div className="rv-summary-panel">
					<div className="rv-summary-table">
						{actionEntries.length === 0 ? (
							<div className="rv-empty-msg">Not in range</div>
						) : (
							actionEntries.map(([action, freq]) => {
								const combosCount = freq * maxCombos;
								const pct = (freq * 100).toFixed(1);
								return (
									<div key={action} className="rv-summary-row">
										<div className="rv-summary-act-info">
											<span
												className="swatch"
												style={{
													backgroundColor: actionColor(action),
												}}
											/>
											<span className="rv-summary-act-title">{action}</span>
										</div>
										<div className="rv-summary-act-stats">
											<span className="rv-summary-combos">
												{combosCount.toFixed(2)} combos
											</span>
											<span className="rv-summary-pct">{pct}%</span>
										</div>
										<div className="rv-summary-bar-track">
											<div
												className="rv-summary-bar-fill"
												style={{
													width: `${pct}%`,
													backgroundColor: actionColor(action),
												}}
											/>
										</div>
									</div>
								);
							})
						)}
					</div>
					{totalActionFreq < 0.99 && (
						<div className="rv-summary-note">
							Remaining {((1 - totalActionFreq) * 100).toFixed(1)}% (
							{((1 - totalActionFreq) * maxCombos).toFixed(2)} combos) is folded.
						</div>
					)}
				</div>
			)}
		</div>
	);
}

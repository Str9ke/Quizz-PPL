extends CanvasLayer

signal fear_changed(value: int, cap: int)
signal fear_maxed_out

@onready var progress_bar: ProgressBar = $Panel/VBoxContainer/ProgressBar
@onready var label: Label = $Panel/VBoxContainer/Label

var fear: int = 0
var fear_cap: int = 10

func _ready() -> void:
	randomize()
	fear_cap = 6 + (randi() % 6) + 1
	progress_bar.max_value = fear_cap
	_update_display()

func increase_fear(amount: int) -> void:
	if fear >= fear_cap:
		return
	fear = min(fear + amount, fear_cap)
	_update_display()
	fear_changed.emit(fear, fear_cap)
	if fear >= fear_cap:
		fear_maxed_out.emit()

func _update_display() -> void:
	progress_bar.value = fear
	label.text = "Peur (%d/%d)" % [fear, fear_cap]

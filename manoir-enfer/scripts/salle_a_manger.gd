extends Control

@onready var result_label: Label = $MarginContainer/VBoxContainer/ResultLabel

func _ready() -> void:
	MapTracker.mark_room_visited("SalleAManger")
	result_label.visible = false

func _on_accept_button_pressed() -> void:
	result_label.text = "Vous vous asseyez face au Comte de Brume. Franklin s'incline et sert le premier plat en silence."
	result_label.visible = true
	FearMeter.increase_fear(1)

func _on_wary_button_pressed() -> void:
	result_label.text = "Vous restez debout, sur vos gardes. Le sourire du Comte se fige un instant avant de revenir, plus large encore."
	result_label.visible = true
	FearMeter.increase_fear(2)

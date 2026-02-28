import re
with open('navlog.html', 'r', encoding='utf-8') as f:
    text = f.read()

bad = '''                if(name){
                  waypoints[rIdx].name=name;
                  var input=document.querySelector('.wp-name-input[data-idx="'+rIdx+'"]');
                  if(input) input.value=name;
                  suggestDossierName();
                  renderNavlog();
                  recalcNavlog();
                }
            }
          })
          .catch(function(){});'''

good = '''                if(name){
                  waypoints[rIdx].name=name;
                }
              }
              renderNavlog();
              recalcNavlog();
              suggestDossierName();
            })
            .catch(function(){
              // En cas d'erreur de reverse geocoding, on recalcule quand meme
              renderNavlog();
              recalcNavlog();
            });'''

if bad in text:
    text = text.replace(bad, good)
    with open('navlog.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print('Patched successfully!')
else:
    print('Could not find bad block')
